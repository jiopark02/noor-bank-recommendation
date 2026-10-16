import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  CHAT_USAGE_LIMITS,
  CHAT_USAGE_RESERVE_TIMEOUT_MS,
  CHAT_USAGE_SETTLE_TIMEOUT_MS,
  CHAT_MAX_MODEL_ATTEMPTS,
  resolveChatUsageMode,
  requestHold,
  settledCost,
  retryAfterSeconds,
  buildUsageLimitBody,
  buildUsageCheckUnavailableBody,
} from "../chatUsageLimits";

/**
 * The mode switch is the only env input to the chat usage limit, and every
 * value that is not exactly "off" or "observe" must enforce, so a mistake can
 * only leave the limit on. The values are written here as literals so that a
 * change to a limit shows up as a change to this file.
 */

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveChatUsageMode", () => {
  it.each([
    [undefined, "enforce"],
    ["", "enforce"],
    ["enforce", "enforce"],
    ["observe", "observe"],
    ["off", "off"],
  ] as const)("maps %j to %s without logging", (raw, mode) => {
    expect(resolveChatUsageMode(raw)).toBe(mode);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(["Off", "OFF", " off", "off ", "obsrve", "true", "Observe", "false"])(
    "enforces %j and logs once, without the value",
    (raw) => {
      expect(resolveChatUsageMode(raw)).toBe("enforce");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain(JSON.stringify(raw).slice(1, -1));
      expect(logged).toContain("unrecognized CHAT_USAGE_LIMIT_MODE");
    }
  );

  it("logs on every call with an unrecognized value", () => {
    resolveChatUsageMode("Off");
    resolveChatUsageMode("Off");
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("agreed values", () => {
  it("holds the agreed limits", () => {
    expect(CHAT_USAGE_LIMITS).toEqual({
      requestsPerHour: 40,
      requestsPerDay: 150,
      costPer30Days: 24,
      attemptHold: 0.05,
    });
  });

  it("holds the agreed timeouts and attempt count", () => {
    expect(CHAT_USAGE_RESERVE_TIMEOUT_MS).toBe(3000);
    expect(CHAT_USAGE_SETTLE_TIMEOUT_MS).toBe(500);
    expect(CHAT_MAX_MODEL_ATTEMPTS).toBe(2);
  });
});

describe("cost arithmetic", () => {
  it("holds a request at every attempt's hold", () => {
    expect(requestHold()).toBe(0.1);
  });

  it("settles an attempt without a cost at the hold, not at zero", () => {
    expect(settledCost([0.001, null])).toBe(0.051);
    expect(settledCost([null])).toBe(0.05);
    expect(settledCost([])).toBe(0);
    expect(settledCost([0])).toBe(0);
  });

  it("keeps a reported cost above the hold as is", () => {
    expect(settledCost([0.2])).toBe(0.2);
  });

  it("treats a cost that is not a finite non-negative number as unknown", () => {
    expect(settledCost([Number.NaN, -1, Number.POSITIVE_INFINITY])).toBe(0.15);
  });

  it("uses the limits it is given", () => {
    const limits = { ...CHAT_USAGE_LIMITS, attemptHold: 0.3 };
    expect(requestHold(limits)).toBe(0.6);
    expect(settledCost([null, 0.1], limits)).toBe(0.4);
  });
});

describe("retryAfterSeconds", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");

  it("rounds up to whole seconds", () => {
    expect(retryAfterSeconds("2026-10-16T12:00:01.200Z", now)).toBe(2);
    expect(retryAfterSeconds("2026-10-16T13:00:00.000Z", now)).toBe(3600);
  });

  it("never answers below one second", () => {
    expect(retryAfterSeconds("2026-10-16T12:00:00.000Z", now)).toBe(1);
    expect(retryAfterSeconds("2026-10-16T11:00:00.000Z", now)).toBe(1);
    expect(retryAfterSeconds("not a date", now)).toBe(1);
  });
});

describe("response bodies", () => {
  it.each(["hour", "day", "30d"] as const)(
    "builds the 429 body for %s",
    (limit) => {
      const body = buildUsageLimitBody(limit, "2026-10-16T13:00:00.000Z");
      expect(body.code).toBe("USAGE_LIMIT_REACHED");
      expect(body.limit).toBe(limit);
      expect(body.retryAt).toBe("2026-10-16T13:00:00.000Z");
      expect(typeof body.error).toBe("string");
      expect(body.error).not.toContain("in a moment");
    }
  );

  it("names a different window for each limit", () => {
    const messages = (["hour", "day", "30d"] as const).map(
      (limit) => buildUsageLimitBody(limit, "2026-10-16T13:00:00.000Z").error
    );
    expect(new Set(messages).size).toBe(3);
  });

  it("builds the 503 body", () => {
    expect(buildUsageCheckUnavailableBody()).toEqual({
      error: "Chat is temporarily unavailable. Please try again shortly.",
      code: "USAGE_CHECK_UNAVAILABLE",
    });
  });
});
