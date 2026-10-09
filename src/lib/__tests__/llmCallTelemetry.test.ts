import { describe, it, expect } from "vitest";
import {
  buildCronLlmCallRow,
  buildLlmCallRow,
  classifyLlmOutcome,
  hasNonEmptyContent,
  parseOpenRouterResponseMeta,
  type LlmCallInput,
  type LlmRoute,
} from "../llmCallTelemetry";

/**
 * The row is the boundary between a provider response and a table the team
 * reads. These tests pin three things: which keys a row has (so a content or
 * error-message field cannot be added quietly), how each attempt is classified,
 * and that malformed provider values become null instead of reaching the insert.
 */

const ALLOWED_ROW_KEYS = [
  "attempt_index",
  "cached_tokens",
  "completion_tokens",
  "error_class",
  "finish_reason",
  "generation_id",
  "has_balance_block",
  "has_financial_snapshot_block",
  "has_memory_block",
  "has_plaid_scaffold_block",
  "http_status",
  "latency_ms",
  "prompt_tokens",
  "provider_cost",
  "reasoning_tokens",
  "request_model",
  "response_model",
  "route",
  "session_id",
  "started_at",
  "succeeded",
  "user_id",
];

function fullBody(): Record<string, unknown> {
  return {
    id: "gen-1760000000-AbCdEf123",
    model: "anthropic/claude-sonnet-4.6",
    choices: [
      { finish_reason: "stop", message: { role: "assistant", content: "Hi" } },
    ],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 80,
      cost: 0.00123,
      prompt_tokens_details: { cached_tokens: 1000 },
      completion_tokens_details: { reasoning_tokens: 12 },
    },
  };
}

function input(overrides: Partial<LlmCallInput> = {}): LlmCallInput {
  return {
    route: "chat",
    attemptIndex: 1,
    requestModel: "anthropic/claude-sonnet-4.6",
    startedAtMs: Date.UTC(2026, 9, 9, 12, 0, 0),
    latencyMs: 1234.4,
    userId: "00000000-0000-0000-0000-000000000001",
    sessionId: "00000000-0000-0000-0000-000000000002",
    httpStatus: 200,
    outcome: { succeeded: true, errorClass: null },
    meta: parseOpenRouterResponseMeta(fullBody()),
    blocks: {
      memory: true,
      plaidScaffold: false,
      balance: true,
      financialSnapshot: false,
    },
    ...overrides,
  };
}

describe("parseOpenRouterResponseMeta", () => {
  it("reads every field from a complete response", () => {
    expect(parseOpenRouterResponseMeta(fullBody())).toEqual({
      generationId: "gen-1760000000-AbCdEf123",
      responseModel: "anthropic/claude-sonnet-4.6",
      finishReason: "stop",
      promptTokens: 1200,
      completionTokens: 80,
      cachedTokens: 1000,
      reasoningTokens: 12,
      providerCost: 0.00123,
    });
  });

  it("returns all nulls for an empty body", () => {
    expect(parseOpenRouterResponseMeta({})).toEqual({
      generationId: null,
      responseModel: null,
      finishReason: null,
      promptTokens: null,
      completionTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      providerCost: null,
    });
  });

  it("leaves cost null when the optional field is absent", () => {
    const body = fullBody();
    delete (body.usage as Record<string, unknown>).cost;
    expect(parseOpenRouterResponseMeta(body).providerCost).toBeNull();
  });

  it("accepts the finish_reason values the parser is meant to keep", () => {
    for (const value of ["stop", "length", "tool_calls", "content_filter"]) {
      const body = fullBody();
      (body.choices as Array<Record<string, unknown>>)[0].finish_reason = value;
      expect(parseOpenRouterResponseMeta(body).finishReason).toBe(value);
    }
  });

  it("drops a finish_reason outside [a-z_]{1,32}", () => {
    for (const value of [
      "Length",
      "x-y",
      "a".repeat(33),
      "",
      "stop ",
      42,
      null,
      { reason: "stop" },
    ]) {
      const body = fullBody();
      (body.choices as Array<Record<string, unknown>>)[0].finish_reason = value;
      expect(parseOpenRouterResponseMeta(body).finishReason).toBeNull();
    }
  });

  it("drops token counts that are not non-negative integers", () => {
    for (const value of ["1200", -1, 1.5, Number.NaN, Infinity, null]) {
      const body = fullBody();
      (body.usage as Record<string, unknown>).prompt_tokens = value;
      expect(parseOpenRouterResponseMeta(body).promptTokens).toBeNull();
    }
  });

  it("drops a negative, non-numeric or out-of-range cost", () => {
    for (const value of [-0.01, "0.01", Number.NaN, 1e7]) {
      const body = fullBody();
      (body.usage as Record<string, unknown>).cost = value;
      expect(parseOpenRouterResponseMeta(body).providerCost).toBeNull();
    }
  });

  it("drops identifiers that are too long or carry unexpected characters", () => {
    const longId = fullBody();
    longId.id = "g".repeat(201);
    expect(parseOpenRouterResponseMeta(longId).generationId).toBeNull();

    const spaced = fullBody();
    spaced.model = "anthropic/claude sonnet\nignore previous";
    expect(parseOpenRouterResponseMeta(spaced).responseModel).toBeNull();

    const tilde = fullBody();
    tilde.model = "~anthropic/claude-sonnet-latest";
    expect(parseOpenRouterResponseMeta(tilde).responseModel).toBe(
      "~anthropic/claude-sonnet-latest"
    );
  });

  it("tolerates nested detail objects being absent or the wrong type", () => {
    const body = fullBody();
    const usage = body.usage as Record<string, unknown>;
    usage.prompt_tokens_details = "n/a";
    delete usage.completion_tokens_details;
    const meta = parseOpenRouterResponseMeta(body);
    expect(meta.cachedTokens).toBeNull();
    expect(meta.reasoningTokens).toBeNull();
    expect(meta.promptTokens).toBe(1200);
  });

  it("tolerates choices being absent, empty or not an array", () => {
    for (const choices of [undefined, [], "x", [null]]) {
      const body = fullBody();
      body.choices = choices;
      expect(parseOpenRouterResponseMeta(body).finishReason).toBeNull();
    }
  });
});

describe("hasNonEmptyContent", () => {
  it("is true only for a string with non-whitespace text", () => {
    expect(hasNonEmptyContent(fullBody())).toBe(true);
    expect(hasNonEmptyContent({})).toBe(false);
    expect(
      hasNonEmptyContent({ choices: [{ message: { content: "  \n" } }] })
    ).toBe(false);
    expect(hasNonEmptyContent({ choices: [{ message: { content: 7 } }] })).toBe(
      false
    );
  });
});

describe("classifyLlmOutcome", () => {
  const ok = { threw: false, jsonParsed: true, contentPresent: true };

  it.each<[number, string]>([
    [400, "client_error"],
    [401, "auth"],
    [402, "insufficient_credits"],
    [403, "auth"],
    [404, "client_error"],
    [413, "client_error"],
    [422, "client_error"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [502, "provider_error"],
    [503, "provider_error"],
    [302, "unknown"],
    [101, "unknown"],
  ])("HTTP %i is a failure classed %s on every route", (status, errorClass) => {
    for (const route of ["chat", "cron_summarize", "cron_extract_facts"] as LlmRoute[]) {
      expect(classifyLlmOutcome({ route, httpStatus: status, ...ok })).toEqual({
        succeeded: false,
        errorClass,
      });
    }
  });

  it("classes a thrown fetch as network_error", () => {
    expect(
      classifyLlmOutcome({
        route: "chat",
        httpStatus: null,
        threw: true,
        jsonParsed: false,
        contentPresent: false,
      })
    ).toEqual({ succeeded: false, errorClass: "network_error" });
  });

  it("classes a 2xx with content as a clean success", () => {
    expect(
      classifyLlmOutcome({ route: "chat", httpStatus: 200, ...ok })
    ).toEqual({ succeeded: true, errorClass: null });
  });

  it("follows chat's existing acceptance of a degraded 2xx", () => {
    expect(
      classifyLlmOutcome({
        route: "chat",
        httpStatus: 200,
        threw: false,
        jsonParsed: false,
        contentPresent: false,
      })
    ).toEqual({ succeeded: true, errorClass: "invalid_json" });
    expect(
      classifyLlmOutcome({
        route: "chat",
        httpStatus: 200,
        threw: false,
        jsonParsed: true,
        contentPresent: false,
      })
    ).toEqual({ succeeded: true, errorClass: "empty_content" });
  });

  it("follows the crons' existing rejection of a degraded 2xx", () => {
    for (const route of ["cron_summarize", "cron_extract_facts"] as LlmRoute[]) {
      expect(
        classifyLlmOutcome({
          route,
          httpStatus: 200,
          threw: false,
          jsonParsed: false,
          contentPresent: false,
        })
      ).toEqual({ succeeded: false, errorClass: "invalid_json" });
      expect(
        classifyLlmOutcome({
          route,
          httpStatus: 200,
          threw: false,
          jsonParsed: true,
          contentPresent: false,
        })
      ).toEqual({ succeeded: false, errorClass: "empty_content" });
    }
  });
});

describe("buildCronLlmCallRow", () => {
  const base = {
    route: "cron_summarize" as const,
    requestModel: "~anthropic/claude-sonnet-latest",
    startedAtMs: Date.UTC(2026, 9, 9, 12, 0, 0),
    latencyMs: 900,
    userId: "00000000-0000-0000-0000-000000000001",
    sessionId: "00000000-0000-0000-0000-000000000002",
  };

  it("records a thrown fetch as network_error with no status", () => {
    const row = buildCronLlmCallRow({
      ...base,
      observed: { httpStatus: null, jsonParsed: false, data: null },
    });
    expect(row.succeeded).toBe(false);
    expect(row.error_class).toBe("network_error");
    expect(row.http_status).toBeNull();
    expect(row.attempt_index).toBe(1);
  });

  it("records a non-2xx by status, with no response fields", () => {
    const row = buildCronLlmCallRow({
      ...base,
      observed: { httpStatus: 503, jsonParsed: false, data: null },
    });
    expect(row.error_class).toBe("provider_error");
    expect(row.http_status).toBe(503);
    expect(row.response_model).toBeNull();
  });

  it("records a 2xx with an unparseable body as a failed invalid_json", () => {
    const row = buildCronLlmCallRow({
      ...base,
      observed: { httpStatus: 200, jsonParsed: false, data: null },
    });
    expect(row.succeeded).toBe(false);
    expect(row.error_class).toBe("invalid_json");
  });

  it("records a full 2xx with every response field and no block flags", () => {
    const row = buildCronLlmCallRow({
      ...base,
      route: "cron_extract_facts",
      observed: { httpStatus: 200, jsonParsed: true, data: fullBody() },
    });
    expect(row.succeeded).toBe(true);
    expect(row.error_class).toBeNull();
    expect(row.route).toBe("cron_extract_facts");
    expect(row.finish_reason).toBe("stop");
    expect(row.prompt_tokens).toBe(1200);
    expect(row.has_memory_block).toBeNull();
    expect(Object.keys(row).sort()).toEqual(ALLOWED_ROW_KEYS);
  });

  it("ignores data that was not marked parsed", () => {
    const row = buildCronLlmCallRow({
      ...base,
      observed: { httpStatus: 200, jsonParsed: false, data: fullBody() },
    });
    expect(row.error_class).toBe("invalid_json");
    expect(row.generation_id).toBeNull();
  });
});

describe("buildLlmCallRow", () => {
  it("produces exactly the allowed keys and nothing else", () => {
    expect(Object.keys(buildLlmCallRow(input())).sort()).toEqual(
      ALLOWED_ROW_KEYS
    );
  });

  it("keeps the same key set for a row with no response at all", () => {
    const row = buildLlmCallRow(
      input({
        httpStatus: null,
        outcome: { succeeded: false, errorClass: "network_error" },
        meta: null,
      })
    );
    expect(Object.keys(row).sort()).toEqual(ALLOWED_ROW_KEYS);
  });

  it("maps a complete chat attempt", () => {
    expect(buildLlmCallRow(input())).toEqual({
      started_at: "2026-10-09T12:00:00.000Z",
      route: "chat",
      attempt_index: 1,
      request_model: "anthropic/claude-sonnet-4.6",
      response_model: "anthropic/claude-sonnet-4.6",
      generation_id: "gen-1760000000-AbCdEf123",
      succeeded: true,
      http_status: 200,
      error_class: null,
      finish_reason: "stop",
      latency_ms: 1234,
      prompt_tokens: 1200,
      completion_tokens: 80,
      cached_tokens: 1000,
      reasoning_tokens: 12,
      provider_cost: 0.00123,
      has_memory_block: true,
      has_plaid_scaffold_block: false,
      has_balance_block: true,
      has_financial_snapshot_block: false,
      user_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
    });
  });

  it("nulls the block flags on cron routes even if blocks are passed", () => {
    const row = buildLlmCallRow(input({ route: "cron_summarize" }));
    expect(row.has_memory_block).toBeNull();
    expect(row.has_plaid_scaffold_block).toBeNull();
    expect(row.has_balance_block).toBeNull();
    expect(row.has_financial_snapshot_block).toBeNull();
  });

  it("does not throw on non-finite timings and keeps them in range", () => {
    const row = buildLlmCallRow(
      input({ startedAtMs: Number.NaN, latencyMs: Number.NaN })
    );
    expect(Number.isNaN(Date.parse(row.started_at))).toBe(false);
    expect(row.latency_ms).toBe(0);
    expect(buildLlmCallRow(input({ latencyMs: -5 })).latency_ms).toBe(0);
  });

  it("caps request_model at the column limit", () => {
    const row = buildLlmCallRow(input({ requestModel: "m".repeat(300) }));
    expect(row.request_model).toHaveLength(200);
  });

  it("drops an out-of-range HTTP status", () => {
    expect(buildLlmCallRow(input({ httpStatus: 42 })).http_status).toBeNull();
  });
});
