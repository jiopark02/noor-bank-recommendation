import { describe, it, expect, afterEach, vi } from "vitest";
import {
  CRISIS_NOTICE_RECORD_TIMEOUT_MS,
  recordCrisisNotice,
  type CrisisNoticeTallyDeps,
} from "../crisisNoticeTally";
import { CHAT_USAGE_SETTLE_TIMEOUT_MS } from "../chatUsageLimits";

/**
 * recordCrisisNotice sends only a category and a variant, never rejects,
 * never waits past its timeout and never logs. The rpc is injected; nothing
 * here touches a database.
 */

function spyConsole(): Array<ReturnType<typeof vi.spyOn>> {
  return (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined)
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recordCrisisNotice", () => {
  it("calls chat_crisis_notice_record with the category and variant only", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const deps: CrisisNoticeTallyDeps = {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return { data: null, error: null };
      },
    };
    await recordCrisisNotice({ category: "eating", variant: "escalated" }, deps);
    expect(calls).toEqual([
      {
        fn: "chat_crisis_notice_record",
        args: { p_category: "eating", p_variant: "escalated" },
      },
    ]);
  });

  it("resolves without logging when the rpc errors, rejects or throws synchronously", async () => {
    const spies = spyConsole();
    const failing: CrisisNoticeTallyDeps["rpc"][] = [
      async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
      async () => {
        throw new Error("network down");
      },
      () => {
        throw new Error("admin client not configured");
      },
    ];
    for (const rpc of failing) {
      await expect(
        recordCrisisNotice({ category: "self_harm", variant: "standard" }, { rpc })
      ).resolves.toBeUndefined();
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("stops waiting at its timeout, aborts the call, and does not log", async () => {
    vi.useFakeTimers();
    const spies = spyConsole();
    let signal: AbortSignal | undefined;
    const deps: CrisisNoticeTallyDeps = {
      rpc: (_fn, _args, s) => {
        signal = s;
        return new Promise(() => undefined);
      },
    };
    let settled = false;
    const done = recordCrisisNotice({ category: "self_harm", variant: "standard" }, deps).then(
      () => {
        settled = true;
      }
    );
    await vi.advanceTimersByTimeAsync(CRISIS_NOTICE_RECORD_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
    expect(signal?.aborted).toBe(true);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("waits no longer than the usage settle, so the request's exit is not lengthened", () => {
    expect(CRISIS_NOTICE_RECORD_TIMEOUT_MS).toBeLessThanOrEqual(CHAT_USAGE_SETTLE_TIMEOUT_MS);
  });
});
