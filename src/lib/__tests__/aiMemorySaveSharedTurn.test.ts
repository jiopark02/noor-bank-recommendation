import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * saveSharedTurn, executed against a fake service-role client: what it sends
 * to chat_shared_turn_save, and what it does with each answer.
 *
 * Mutations and the test each one turns red:
 *   p_user_id or a message id taken from anything but the arguments     -> T12
 *   the pairs sent in another order or shape                            -> T12
 *   'not_shared' or 'busy' treated as stored                            -> T13
 *   'session_closed' or NR001 not turned into SessionClosedError        -> T13
 *   'busy' retried more than once, not at all, or without the wait      -> T13
 *   a retry sent after the request was cancelled                        -> T13
 *   the marked pairs or their session not sent, sent as added pairs, or
 *     marked pairs accepted without their session                       -> N13
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MARKED_SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = "00000000-0000-4000-8000-000000000002";
const IDS = {
  user: "11111111-1111-4111-8111-111111111111",
  assistant: "22222222-2222-4222-8222-222222222222",
};

type Answer = { data: unknown; error: unknown };

const fake = {
  answers: [] as Answer[],
  calls: [] as Array<{ fn: string; args: Record<string, unknown>; signal?: AbortSignal }>,
};

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      const call: { fn: string; args: Record<string, unknown>; signal?: AbortSignal } = { fn, args };
      fake.calls.push(call);
      const answer = fake.answers.shift() ?? { data: null, error: { code: "unscripted" } };
      const promise = Promise.resolve(answer);
      return Object.assign(promise, {
        abortSignal(signal: AbortSignal) {
          call.signal = signal;
          return promise;
        },
      });
    },
  }),
  isSupabaseAdminConfigured: () => true,
}));

import {
  saveSharedTurn,
  SessionClosedError,
  SharedSourceEndedError,
  SharedTurnBusyError,
  SHARED_TURN_BUSY_RETRY_MS,
} from "../aiMemory";

const PAIR = {
  userContent: "How much does Alex have?",
  assistantContent: "Alex has $10.00 in checking.",
  assistantModel: "sentinel/model",
  inputTokens: 12,
  outputTokens: 34,
};

const SOURCES = {
  markedSessionId: null,
  marked: [],
  added: [
    { ownerUserId: OWNER, connectionId: 7002 },
    { ownerUserId: OWNER, connectionId: 7001 },
  ],
};

let sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

beforeEach(() => {
  fake.answers = [];
  fake.calls = [];
  sleeps = [];
});

describe("saveSharedTurn — what it sends (T12)", () => {
  it("calls the function once with the authenticated id, the session, the pairs and the chosen ids", async () => {
    fake.answers = [{ data: "saved", error: null }];
    const signal = new AbortController().signal;
    await saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, signal, sleep });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].fn).toBe("chat_shared_turn_save");
    expect(fake.calls[0].args).toEqual({
      p_session_id: SESSION,
      p_user_id: USER_ID,
      p_marked_session_id: null,
      p_marked_owner_user_ids: [],
      p_marked_resource_ids: [],
      p_owner_user_ids: [OWNER, OWNER],
      p_resource_ids: [7002, 7001],
      p_user_message_id: IDS.user,
      p_assistant_message_id: IDS.assistant,
      p_user_content: PAIR.userContent,
      p_assistant_content: PAIR.assistantContent,
      p_model: "sentinel/model",
      p_input_tokens: 12,
      p_output_tokens: 34,
    });
    expect(fake.calls[0].signal).toBe(signal);
  });

  it("sends null for a model and token counts not given", async () => {
    fake.answers = [{ data: "saved", error: null }];
    await saveSharedTurn(
      SESSION,
      USER_ID,
      { userContent: "a", assistantContent: "b" },
      SOURCES,
      { ids: IDS, sleep }
    );
    expect(fake.calls[0].args).toMatchObject({ p_model: null, p_input_tokens: null, p_output_tokens: null });
  });

  it("refuses empty content or no source before calling", async () => {
    await expect(
      saveSharedTurn(SESSION, USER_ID, { ...PAIR, userContent: " " }, SOURCES, { ids: IDS, sleep })
    ).rejects.toThrow();
    await expect(
      saveSharedTurn(SESSION, USER_ID, { ...PAIR, assistantContent: "" }, SOURCES, { ids: IDS, sleep })
    ).rejects.toThrow();
    await expect(
      saveSharedTurn(
        SESSION,
        USER_ID,
        PAIR,
        { markedSessionId: null, marked: [], added: [] },
        { ids: IDS, sleep }
      )
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("N13 sends the marked pairs with the session they were read from, apart from the pairs added this turn", async () => {
    fake.answers = [{ data: "saved", error: null }];
    await saveSharedTurn(
      SESSION,
      USER_ID,
      PAIR,
      {
        markedSessionId: MARKED_SESSION,
        marked: [{ ownerUserId: OWNER, connectionId: 7001 }],
        added: [{ ownerUserId: OWNER, connectionId: 7003 }],
      },
      { ids: IDS, sleep }
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].args).toMatchObject({
      p_session_id: SESSION,
      p_user_id: USER_ID,
      p_marked_session_id: MARKED_SESSION,
      p_marked_owner_user_ids: [OWNER],
      p_marked_resource_ids: [7001],
      p_owner_user_ids: [OWNER],
      p_resource_ids: [7003],
    });
  });

  it("N13 marked pairs alone are a turn to save, with no pair added", async () => {
    fake.answers = [{ data: "saved", error: null }];
    await saveSharedTurn(
      SESSION,
      USER_ID,
      PAIR,
      {
        markedSessionId: SESSION,
        marked: [{ ownerUserId: OWNER, connectionId: 7001 }],
        added: [],
      },
      { ids: IDS, sleep }
    );
    expect(fake.calls[0].args).toMatchObject({
      p_marked_session_id: SESSION,
      p_marked_owner_user_ids: [OWNER],
      p_marked_resource_ids: [7001],
      p_owner_user_ids: [],
      p_resource_ids: [],
    });
  });

  it("N13 marked pairs without the session they were read from are refused before calling", async () => {
    await expect(
      saveSharedTurn(
        SESSION,
        USER_ID,
        PAIR,
        {
          markedSessionId: null,
          marked: [{ ownerUserId: OWNER, connectionId: 7001 }],
          added: [],
        },
        { ids: IDS, sleep }
      )
    ).rejects.toThrow("saveSharedTurn: marked sources need the session they were read from");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("saveSharedTurn — what each answer means (T13)", () => {
  it("'saved' resolves", async () => {
    fake.answers = [{ data: "saved", error: null }];
    await expect(saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep })).resolves.toBeUndefined();
  });

  it("'session_closed' and NR001 are a closed session", async () => {
    fake.answers = [{ data: "session_closed", error: null }];
    await expect(saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep })).rejects.toBeInstanceOf(
      SessionClosedError
    );
    fake.answers = [{ data: null, error: { code: "NR001", message: "closed" } }];
    await expect(saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep })).rejects.toBeInstanceOf(
      SessionClosedError
    );
    expect(fake.calls).toHaveLength(2);
  });

  it("'not_shared' is sharing that ended, with no second call", async () => {
    fake.answers = [{ data: "not_shared", error: null }];
    await expect(saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep })).rejects.toBeInstanceOf(
      SharedSourceEndedError
    );
    expect(fake.calls).toHaveLength(1);
  });

  it("'busy' is tried once more after the wait, and stored on the second try", async () => {
    fake.answers = [
      { data: "busy", error: null },
      { data: "saved", error: null },
    ];
    await saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].args).toEqual(fake.calls[0].args);
    expect(sleeps).toEqual([SHARED_TURN_BUSY_RETRY_MS]);
  });

  it("'busy' twice throws SharedTurnBusyError after two calls and one wait", async () => {
    fake.answers = [
      { data: "busy", error: null },
      { data: "busy", error: null },
      { data: "saved", error: null },
    ];
    await expect(saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep })).rejects.toBeInstanceOf(
      SharedTurnBusyError
    );
    expect(fake.calls).toHaveLength(2);
    expect(sleeps).toEqual([SHARED_TURN_BUSY_RETRY_MS]);
  });

  it("'busy' with the request already cancelled makes no second call", async () => {
    const controller = new AbortController();
    fake.answers = [{ data: "busy", error: null }];
    await expect(
      saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, {
        ids: IDS,
        signal: controller.signal,
        sleep: async () => controller.abort(),
      })
    ).rejects.toBeInstanceOf(SharedTurnBusyError);
    expect(fake.calls).toHaveLength(1);
  });

  it("any other answer or error throws something else, keeping the error's code", async () => {
    fake.answers = [{ data: "maybe", error: null }];
    const odd = await saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep }).catch((e: unknown) => e);
    expect(odd).toBeInstanceOf(Error);
    expect(odd).not.toBeInstanceOf(SharedTurnBusyError);
    expect(odd).not.toBeInstanceOf(SharedSourceEndedError);

    fake.answers = [{ data: null, error: { code: "57014", message: "cancelled" } }];
    const failed = await saveSharedTurn(SESSION, USER_ID, PAIR, SOURCES, { ids: IDS, sleep }).catch((e: unknown) => e);
    expect((failed as Error).cause).toEqual({ code: "57014", message: "cancelled" });
    expect(failed).not.toBeInstanceOf(SessionClosedError);
  });
});
