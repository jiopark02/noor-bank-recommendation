import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { LLM_CALL_LOG_TIMEOUT_MS, recordLlmCall } from "../llmCallLog";
import type { LlmCallRow } from "../llmCallTelemetry";

/**
 * recordLlmCall is awaited on the chat request path, including inside the catch
 * that rethrows a fetch error. If it ever rejected, the caller's own error or
 * response would be replaced; if it ever hung, the user's reply would wait on
 * the database. These tests hold both halves of its contract: it always
 * resolves, and it resolves by the timeout at the latest.
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
  });

  it("resolves when insert rejects", async () => {
    const insert = () => Promise.reject(new Error("connection reset"));
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves when insert throws synchronously", async () => {
    const insert = (): Promise<{ error: unknown }> => {
      throw new Error("Supabase URL and service role key are required");
    };
    await expect(recordLlmCall(row, { insert })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves at the timeout when insert never settles", async () => {
    vi.useFakeTimers();
    const insert = () => new Promise<{ error: unknown }>(() => undefined);
    let settled = false;
    const pending = recordLlmCall(row, { insert }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(LLM_CALL_LOG_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    await pending;
  });

  it("uses a 1500ms ceiling", () => {
    expect(LLM_CALL_LOG_TIMEOUT_MS).toBe(1500);
  });
});
