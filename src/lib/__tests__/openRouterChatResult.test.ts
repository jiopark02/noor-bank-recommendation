import { describe, it, expect } from "vitest";
import {
  readJsonBodyLeniently,
  toOpenRouterResult,
} from "../openRouterChatResult";

/**
 * Characterization tests. readJsonBodyLeniently and toOpenRouterResult were
 * moved out of src/app/api/chat/route.ts, where the body read was
 * `asPlainObject(await res.json().catch(() => ({})))` followed by the result
 * construction inline. Every expected value below is what that inline code
 * produced for the same input, so a change here is a change to what the chat
 * route returns to the client and stores in chat_messages.
 *
 * What this does not prove: that the route calls these functions. That is
 * held by tsc and chatLlmTelemetryWiring.test.ts.
 */

const FALLBACK = "Sorry, I could not generate a response.";

describe("readJsonBodyLeniently", () => {
  it("turns a non-JSON body into {} and reports it", async () => {
    const res = new Response("<html>Bad gateway</html>", { status: 200 });
    await expect(readJsonBodyLeniently(res)).resolves.toEqual({
      data: {},
      jsonParsed: false,
    });
  });

  it("turns an empty body into {} and reports it", async () => {
    const res = new Response("", { status: 200 });
    await expect(readJsonBodyLeniently(res)).resolves.toEqual({
      data: {},
      jsonParsed: false,
    });
  });

  it("returns a JSON object as is", async () => {
    const res = new Response(JSON.stringify({ id: "g", choices: [] }), {
      status: 200,
    });
    await expect(readJsonBodyLeniently(res)).resolves.toEqual({
      data: { id: "g", choices: [] },
      jsonParsed: true,
    });
  });

  it("turns JSON that is not an object into {} but reports it parsed", async () => {
    for (const body of ["[1,2]", "null", "\"text\"", "3"]) {
      const res = new Response(body, { status: 200 });
      await expect(readJsonBodyLeniently(res)).resolves.toEqual({
        data: {},
        jsonParsed: true,
      });
    }
  });
});

describe("toOpenRouterResult", () => {
  it("answers a 2xx whose body was not JSON with the fallback message", () => {
    expect(
      toOpenRouterResult({ ok: true, status: 200, data: {}, model: "m" })
    ).toEqual({
      ok: true,
      status: 200,
      model: "m",
      message: FALLBACK,
      usage: undefined,
    });
  });

  it("answers empty content with the fallback message", () => {
    expect(
      toOpenRouterResult({
        ok: true,
        status: 200,
        data: { choices: [{ message: { content: "" } }] },
        model: "m",
      })
    ).toEqual({
      ok: true,
      status: 200,
      model: "m",
      message: FALLBACK,
      usage: undefined,
    });
  });

  it("reports 200 even when the provider's success status was another 2xx", () => {
    expect(
      toOpenRouterResult({ ok: true, status: 201, data: {}, model: "m" }).status
    ).toBe(200);
  });

  it("returns the content and the requested model, not the response model", () => {
    const result = toOpenRouterResult({
      ok: true,
      status: 200,
      data: {
        model: "provider/actual-model",
        choices: [{ message: { content: "Hello" } }],
      },
      model: "requested/model",
    });
    expect(result.message).toBe("Hello");
    expect(result.model).toBe("requested/model");
  });

  it("maps prompt/completion token names into input/output", () => {
    const result = toOpenRouterResult({
      ok: true,
      status: 200,
      data: {
        choices: [{ message: { content: "x" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          cost: 0.5,
          prompt_tokens_details: { cached_tokens: 8 },
        },
      },
      model: "m",
    });
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 3 });
    expect(Object.keys(result.usage ?? {}).sort()).toEqual([
      "input_tokens",
      "output_tokens",
    ]);
  });

  it("falls back to input/output token names", () => {
    const result = toOpenRouterResult({
      ok: true,
      status: 200,
      data: {
        choices: [{ message: { content: "x" } }],
        usage: { input_tokens: 4, output_tokens: 2 },
      },
      model: "m",
    });
    expect(result.usage).toEqual({ input_tokens: 4, output_tokens: 2 });
  });

  it("keeps both usage keys, undefined, when usage has neither name", () => {
    const result = toOpenRouterResult({
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: "x" } }], usage: {} },
      model: "m",
    });
    expect(result.usage).toEqual({
      input_tokens: undefined,
      output_tokens: undefined,
    });
    expect(Object.keys(result.usage ?? {}).sort()).toEqual([
      "input_tokens",
      "output_tokens",
    ]);
  });

  it("carries the provider's error message on a failure", () => {
    expect(
      toOpenRouterResult({
        ok: false,
        status: 404,
        data: { error: { message: "X is not a valid model ID" } },
        model: "m",
      })
    ).toEqual({
      ok: false,
      status: 404,
      error: "X is not a valid model ID",
      model: "m",
    });
  });

  it("falls back to a top-level message, then to a fixed string", () => {
    expect(
      toOpenRouterResult({
        ok: false,
        status: 500,
        data: { message: "upstream" },
        model: "m",
      }).error
    ).toBe("upstream");
    expect(
      toOpenRouterResult({ ok: false, status: 502, data: {}, model: "m" })
    ).toEqual({
      ok: false,
      status: 502,
      error: "OpenRouter request failed",
      model: "m",
    });
  });
});
