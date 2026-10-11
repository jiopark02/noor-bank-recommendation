import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_URL,
  buildOpenRouterRequestBody,
  resolveOpenRouterApiKey,
} from "../openRouterRequest";

describe("OPENROUTER_URL", () => {
  it("is the chat-completions endpoint", () => {
    expect(OPENROUTER_URL).toBe(
      "https://openrouter.ai/api/v1/chat/completions"
    );
  });
});

describe("resolveOpenRouterApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when the variable is unset", () => {
    // Stub first so unstubAllEnvs restores the original value afterwards.
    vi.stubEnv("OPENROUTER_API_KEY", "placeholder");
    delete process.env.OPENROUTER_API_KEY;
    expect(resolveOpenRouterApiKey()).toBeNull();
  });

  it("returns null when the variable is empty", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(resolveOpenRouterApiKey()).toBeNull();
  });

  it("returns null when the variable is whitespace only", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "   \t ");
    expect(resolveOpenRouterApiKey()).toBeNull();
  });

  it("returns the trimmed value", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "  sk-test-value \n");
    expect(resolveOpenRouterApiKey()).toBe("sk-test-value");
  });
});

describe("buildOpenRouterRequestBody", () => {
  it("maps the input to the request body field names, and nothing else", () => {
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    expect(
      buildOpenRouterRequestBody({ model: "m/x", messages, maxTokens: 7 })
    ).toEqual({
      model: "m/x",
      messages,
      max_tokens: 7,
    });
  });
});
