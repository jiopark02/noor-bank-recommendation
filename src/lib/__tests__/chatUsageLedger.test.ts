import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  reserveChatUsage,
  settleChatUsage,
  ChatUsageCheckError,
  type ChatUsageLedgerDeps,
} from "../chatUsageLedger";

/**
 * reserveChatUsage must throw on every failure, so the route can never read
 * "could not check" as "allowed"; settleChatUsage must never reject and never
 * hold the response past its ceiling. The ceilings are written here as
 * literals (3000 ms reserve, 500 ms settle) so changing a constant fails a
 * test.
 */

const USER_ID = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
const RESERVATION_ID = "0b6c6c3e-9a3a-4c55-9d0e-0b8f6f0d7a11";

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function rpcReturning(
  result: { data: unknown; error: unknown }
): ChatUsageLedgerDeps["rpc"] & ReturnType<typeof vi.fn> {
  return vi.fn(async () => result);
}

const never = () => new Promise<{ data: unknown; error: unknown }>(() => undefined);

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("reserveChatUsage", () => {
  it("calls chat_usage_reserve with the agreed limits and the user id verbatim", async () => {
    const rpc = rpcReturning({
      data: [{ allowed: true, limit_hit: null, retry_at: null }],
      error: null,
    });
    await reserveChatUsage(
      { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
      { rpc }
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args, signal] = rpc.mock.calls[0];
    expect(fn).toBe("chat_usage_reserve");
    expect(args).toEqual({
      p_reservation_id: RESERVATION_ID,
      p_user_id: USER_ID,
      p_hold_cost: 0.1,
      p_max_per_hour: 40,
      p_max_per_day: 150,
      p_max_cost_30d: 24,
      p_enforce: true,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("passes p_enforce false under observe", async () => {
    const rpc = rpcReturning({
      data: [{ allowed: true, limit_hit: null, retry_at: null }],
      error: null,
    });
    await reserveChatUsage(
      { reservationId: RESERVATION_ID, userId: USER_ID, mode: "observe" },
      { rpc }
    );
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_enforce: false });
  });

  it("normalizes an admitted row", async () => {
    const rpc = rpcReturning({
      data: [
        { allowed: true, limit_hit: null, retry_at: null, hour_count: 3, day_count: 9, cost_30d: 1.2 },
      ],
      error: null,
    });
    await expect(
      reserveChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
        { rpc }
      )
    ).resolves.toEqual({ allowed: true, limit: null, retryAt: null });
  });

  it("normalizes a refused row", async () => {
    const rpc = rpcReturning({
      data: [
        { allowed: false, limit_hit: "day", retry_at: "2026-10-17T09:00:00+00:00" },
      ],
      error: null,
    });
    await expect(
      reserveChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
        { rpc }
      )
    ).resolves.toEqual({
      allowed: false,
      limit: "day",
      retryAt: "2026-10-17T09:00:00+00:00",
    });
  });

  it("throws on an RPC error, keeping the code and not the message", async () => {
    const rpc = rpcReturning({
      data: null,
      error: { code: "42883", message: "function public.chat_usage_reserve does not exist" },
    });
    const error = await caught(
      reserveChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
        { rpc }
      )
    );
    expect(error).toBeInstanceOf(ChatUsageCheckError);
    expect((error as ChatUsageCheckError).reason).toBe("rpc_error");
    expect((error as ChatUsageCheckError).code).toBe("42883");
    expect((error as Error).message).not.toContain("does not exist");
  });

  it("throws when the client throws synchronously", async () => {
    const rpc: ChatUsageLedgerDeps["rpc"] = () => {
      throw new Error("Supabase URL and service role key are required");
    };
    const error = await caught(
      reserveChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
        { rpc }
      )
    );
    expect((error as ChatUsageCheckError).reason).toBe("threw");
  });

  it.each([
    ["no rows", []],
    ["two rows", [
      { allowed: true, limit_hit: null, retry_at: null },
      { allowed: true, limit_hit: null, retry_at: null },
    ]],
    ["null data", null],
    ["allowed not boolean", [{ allowed: "true", limit_hit: null, retry_at: null }]],
    ["refused without a limit", [{ allowed: false, limit_hit: null, retry_at: null }]],
    ["unknown limit", [{ allowed: false, limit_hit: "week", retry_at: "2026-10-17T09:00:00Z" }]],
    ["limit without retry_at", [{ allowed: false, limit_hit: "hour", retry_at: null }]],
    ["limit with a bad retry_at", [{ allowed: false, limit_hit: "hour", retry_at: "soon" }]],
    ["limit reported as allowed", [{ allowed: true, limit_hit: "hour", retry_at: "2026-10-17T09:00:00Z" }]],
  ])("throws on a malformed answer: %s", async (_label, data) => {
    const rpc = rpcReturning({ data, error: null });
    const error = await caught(
      reserveChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
        { rpc }
      )
    );
    expect((error as ChatUsageCheckError).reason).toBe("malformed");
  });

  it("throws at 3000 ms and aborts the request", async () => {
    vi.useFakeTimers();
    let seenSignal: AbortSignal | undefined;
    const rpc: ChatUsageLedgerDeps["rpc"] = (_fn, _args, signal) => {
      seenSignal = signal;
      return never();
    };
    let settled: unknown = "pending";
    const pending = reserveChatUsage(
      { reservationId: RESERVATION_ID, userId: USER_ID, mode: "enforce" },
      { rpc }
    ).then(
      () => (settled = "resolved"),
      (error) => (settled = error)
    );

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe("pending");
    expect(seenSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBeInstanceOf(ChatUsageCheckError);
    expect((settled as ChatUsageCheckError).reason).toBe("timeout");
    expect(seenSignal?.aborted).toBe(true);
  });
});

describe("settleChatUsage", () => {
  it("calls chat_usage_settle with the reservation, user, cost and attempts", async () => {
    const rpc = rpcReturning({ data: 1, error: null });
    await settleChatUsage(
      { reservationId: RESERVATION_ID, userId: USER_ID, cost: 0.051, attempts: 2 },
      { rpc }
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("chat_usage_settle");
    expect(rpc.mock.calls[0][1]).toEqual({
      p_reservation_id: RESERVATION_ID,
      p_user_id: USER_ID,
      p_cost: 0.051,
      p_attempts: 2,
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolves at 500 ms when the call never settles, and not before", async () => {
    vi.useFakeTimers();
    let seenSignal: AbortSignal | undefined;
    const rpc: ChatUsageLedgerDeps["rpc"] = (_fn, _args, signal) => {
      seenSignal = signal;
      return never();
    };
    let done = false;
    const pending = settleChatUsage(
      { reservationId: RESERVATION_ID, userId: USER_ID, cost: 0, attempts: 0 },
      { rpc }
    ).then(() => (done = true));

    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
    expect(seenSignal?.aborted).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves on an RPC error and logs the code, not the message", async () => {
    const rpc = rpcReturning({
      data: null,
      error: { code: "23514", message: "violates check constraint, value 0.051" },
    });
    await expect(
      settleChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, cost: 0.051, attempts: 1 },
        { rpc }
      )
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({ code: "23514" });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("violates");
    expect(logged).not.toContain(USER_ID);
  });

  it("resolves when the call rejects or throws", async () => {
    await expect(
      settleChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, cost: 0, attempts: 0 },
        { rpc: () => Promise.reject(new Error("connection reset")) }
      )
    ).resolves.toBeUndefined();
    await expect(
      settleChatUsage(
        { reservationId: RESERVATION_ID, userId: USER_ID, cost: 0, attempts: 0 },
        {
          rpc: () => {
            throw new Error("Supabase URL and service role key are required");
          },
        }
      )
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("connection reset");
  });
});
