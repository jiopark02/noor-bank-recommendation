import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { recordLlmCall } from "../llmCallLog";
import type { LlmCallRow } from "../llmCallTelemetry";

/**
 * recordLlmCall is awaited on the chat request path, including inside the catch
 * that rethrows a fetch error. If it ever rejected, the caller's own error or
 * response would be replaced; if it ever hung, the user's reply would wait on
 * the database. These tests hold both halves of its contract: it always
 * resolves, and it resolves by its route's ceiling at the latest.
 *
 * The ceilings are written here as literals (500ms chat, 1500ms crons) rather
 * than read from the exported constants, so changing a constant fails a test.
 */

const row = { route: "chat" } as unknown as LlmCallRow;

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

describe("recordLlmCall", () => {
  it("passes the row to insert and logs nothing on success", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith(row);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolves and logs when insert reports an error", async () => {
    const insert = async () => ({ error: { code: "23503", message: "fk" } });
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({ route: "chat", code: "23503" });
  });

  it("resolves when insert rejects, and names the route", async () => {
    const insert = () => Promise.reject(new Error("connection reset"));
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({ route: "chat", code: null });
  });

  it("resolves when insert throws synchronously, and names the route", async () => {
    const insert = (): Promise<{ error: unknown }> => {
      throw new Error("Supabase URL and service role key are required");
    };
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({ route: "chat", code: null });
  });

  it("logs the route and error code, and no other row value", async () => {
    const sentinelRow = {
      route: "cron_summarize",
      user_id: "user-sentinel",
      request_model: "model-sentinel",
      prompt_tokens: 777,
    } as unknown as LlmCallRow;
    const insert = async () => ({
      error: {
        code: "23503",
        message: "fk",
        details: "Key (user_id)=(user-sentinel) is not present",
      },
    });
    await expect(
      recordLlmCall(sentinelRow, { insert })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('"route":"cron_summarize"');
    expect(logged).toContain('"code":"23503"');
    expect(logged).not.toContain("user-sentinel");
    expect(logged).not.toContain("model-sentinel");
    expect(logged).not.toContain("777");
    expect(logged).not.toContain("Key (");
  });

  it("logs the error code and never the error message", async () => {
    const insert = async () => ({
      error: {
        code: "22P02",
        message: 'invalid input syntax for type uuid: "message-sentinel"',
      },
    });
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('"code":"22P02"');
    expect(logged).not.toContain("message-sentinel");
  });

  it("resolves and logs a non-string route when reading route throws", async () => {
    const throwingRow = {
      get route(): string {
        throw new Error("route-getter-sentinel");
      },
    } as unknown as LlmCallRow;
    const insert = vi.fn(async () => ({ error: null }));
    await expect(
      recordLlmCall(throwingRow, { insert })
    ).resolves.toBeUndefined();

    expect(insert).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('"route":"non-string"');
    expect(logged).not.toContain("route-getter-sentinel");
  });

  it("resolves and logs a non-string route when route is an object", async () => {
    const objectRow = {
      route: { sentinel: "object-route-sentinel" },
    } as unknown as LlmCallRow;
    const insert = async () => ({ error: { code: "23514", message: "check" } });
    await expect(recordLlmCall(objectRow, { insert })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('"route":"non-string"');
    expect(logged).not.toContain("object-route-sentinel");
  });

  it("resolves at 500ms for a chat row when insert never settles", async () => {
    vi.useFakeTimers();
    const insert = () => new Promise<{ error: unknown }>(() => undefined);
    let settled = false;
    const pending = recordLlmCall(row, { insert }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toEqual({ route: "chat" });
    await pending;
  });

  it.each(["cron_summarize", "cron_extract_facts"])(
    "resolves at 1500ms for a %s row when insert never settles",
    async (route) => {
      vi.useFakeTimers();
      const cronRow = { route } as unknown as LlmCallRow;
      const insert = () => new Promise<{ error: unknown }>(() => undefined);
      let settled = false;
      const pending = recordLlmCall(cronRow, { insert }).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(1499);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toEqual({ route });
      await pending;
    }
  );
});
