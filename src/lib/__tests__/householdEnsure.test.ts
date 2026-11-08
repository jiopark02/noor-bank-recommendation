import { describe, it, expect, vi } from "vitest";
import {
  ensureHouseholdForUser,
  HOUSEHOLD_ENSURE_FUNCTION,
} from "../householdEnsure";

/**
 * ensureHouseholdForUser, executed against a fake rpc. Whether the SQL
 * function itself is idempotent under concurrent calls is database behaviour
 * and is not tested here; this holds what the wrapper does with its answer.
 *
 * Mutations of householdEnsure.ts and the tests each one turns red:
 *   the function name or the p_user_id argument name changed -> HE1
 *   the error check removed                                   -> HE2
 *   the non-string / empty answer check removed               -> HE3
 *   the try/catch removed                                     -> HE4
 *   a returned id replaced or not passed through              -> HE1
 *   error content placed in the log line                      -> HE5
 */

const USER_ID = "8d0f1c1e-0000-4000-8000-000000000001";
const HOUSEHOLD_ID = "5b2a9e4c-0000-4000-8000-000000000002";
const SENTINEL = "SENTINEL_never_logged_41c9";

function fakeRpc(answer: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => answer) };
}

describe("ensureHouseholdForUser", () => {
  it("HE1 calls household_ensure_for_user with p_user_id and passes the id through", async () => {
    const client = fakeRpc({ data: HOUSEHOLD_ID, error: null });
    const log = vi.fn();
    const result = await ensureHouseholdForUser(client as never, USER_ID, log);
    expect(HOUSEHOLD_ENSURE_FUNCTION).toBe("household_ensure_for_user");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("household_ensure_for_user", {
      p_user_id: USER_ID,
    });
    expect(result).toEqual({ ok: true, householdId: HOUSEHOLD_ID });
    expect(log).not.toHaveBeenCalled();
  });

  it("HE2 answers ok:false when the call returns an error, even with data", async () => {
    const client = fakeRpc({
      data: HOUSEHOLD_ID,
      error: { code: "23503", message: SENTINEL },
    });
    const log = vi.fn();
    const result = await ensureHouseholdForUser(client as never, USER_ID, log);
    expect(result).toEqual({ ok: false });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("code=23503");
  });

  it.each([null, undefined, "", 42, { id: HOUSEHOLD_ID }, [HOUSEHOLD_ID]])(
    "HE3 answers ok:false when the answer is %j",
    async (data) => {
      const client = fakeRpc({ data, error: null });
      const log = vi.fn();
      const result = await ensureHouseholdForUser(client as never, USER_ID, log);
      expect(result).toEqual({ ok: false });
      expect(log).toHaveBeenCalledTimes(1);
    }
  );

  it("HE4 answers ok:false when the call throws", async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error(SENTINEL);
      }),
    };
    const log = vi.fn();
    const result = await ensureHouseholdForUser(client as never, USER_ID, log);
    expect(result).toEqual({ ok: false });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("HE5 never logs error messages or the user id", async () => {
    const log = vi.fn();
    await ensureHouseholdForUser(
      fakeRpc({ data: null, error: { code: "42501", message: SENTINEL } }) as never,
      USER_ID,
      log
    );
    await ensureHouseholdForUser(
      {
        rpc: vi.fn(async () => {
          throw new Error(SENTINEL);
        }),
      } as never,
      USER_ID,
      log
    );
    for (const call of log.mock.calls) {
      expect(String(call[0])).not.toContain(SENTINEL);
      expect(String(call[0])).not.toContain(USER_ID);
    }
  });
});
