import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_PROVIDER_PREFERENCES,
  OPENROUTER_URL,
  buildOpenRouterRequestBody,
  resolveOpenRouterApiKey,
} from "../openRouterRequest";

const EXPECTED_PROVIDER = {
  zdr: true,
  data_collection: "deny",
  only: [
    "amazon-bedrock/us",
    "amazon-bedrock/us-east-1",
    "google-vertex/us",
    "google-vertex/us-east5",
  ],
};

describe("OPENROUTER_PROVIDER_PREFERENCES", () => {
  it("requires zero data retention, denies data collection, and allows only US-tagged endpoints", () => {
    expect(OPENROUTER_PROVIDER_PREFERENCES).toEqual(EXPECTED_PROVIDER);
  });

  it("names only region-tagged slugs, never a bare provider that matches every region", () => {
    for (const slug of OPENROUTER_PROVIDER_PREFERENCES.only) {
      expect(slug).toMatch(/^[a-z-]+\/us(-[a-z0-9-]+)?$/);
    }
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(OPENROUTER_PROVIDER_PREFERENCES)).toBe(true);
    expect(Object.isFrozen(OPENROUTER_PROVIDER_PREFERENCES.only)).toBe(true);
  });
});

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
  const messages = [
    { role: "system" as const, content: "s" },
    { role: "user" as const, content: "u" },
  ];

  it("maps the input to the request body field names and adds the provider preferences", () => {
    expect(
      buildOpenRouterRequestBody({ model: "m/x", messages, maxTokens: 7 })
    ).toEqual({
      model: "m/x",
      messages,
      max_tokens: 7,
      provider: EXPECTED_PROVIDER,
    });
  });

  it("carries the provider preferences for every model, including aliases", () => {
    for (const model of [
      "~anthropic/claude-sonnet-latest",
      "anthropic/claude-sonnet-4.6",
      "google/gemini-2.5-flash-lite",
    ]) {
      const body = buildOpenRouterRequestBody({ model, messages, maxTokens: 1 });
      expect(body.provider).toEqual(EXPECTED_PROVIDER);
    }
  });

  it("serializes the provider preferences into the JSON that is sent", () => {
    const sent = JSON.parse(
      JSON.stringify(
        buildOpenRouterRequestBody({ model: "m/x", messages, maxTokens: 7 })
      )
    );
    expect(sent.provider).toEqual(EXPECTED_PROVIDER);
  });
});
