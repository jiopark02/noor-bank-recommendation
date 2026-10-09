/**
 * openRouterChatResult — how the chat route reads an OpenRouter chat
 * completion response. Moved out of src/app/api/chat/route.ts unchanged so its
 * behavior can be executed by tests; openRouterChatResult.test.ts pins that
 * behavior to what the route did before the move.
 *
 * ⚠️ OpenRouterResult reaches the client. The route returns `result.usage` and
 * `result.model` in its response body and stores them in chat_messages. Adding
 * a field to `usage`, or putting the provider's response model in `model`,
 * changes what the client receives and what is stored. Telemetry fields belong
 * in llmCallTelemetry.ts, not here.
 */

import { asPlainObject, readFiniteNumber } from "@/lib/requestJson";

export interface OpenRouterResult {
  ok: boolean;
  status: number;
  message?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: string;
  model: string;
}

/**
 * Reads the body as JSON the way the route always has: a body that is not
 * JSON becomes `{}`. `jsonParsed` reports which of the two happened; it is
 * used for telemetry only and changes nothing about `data`.
 */
export async function readJsonBodyLeniently(res: {
  json(): Promise<unknown>;
}): Promise<{ data: Record<string, unknown>; jsonParsed: boolean }> {
  let jsonParsed = true;
  const raw = await res.json().catch(() => {
    jsonParsed = false;
    return {};
  });
  return { data: asPlainObject(raw), jsonParsed };
}

export function toOpenRouterResult(input: {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  model: string;
}): OpenRouterResult {
  const { data, model } = input;

  if (!input.ok) {
    const errNested = data.error;
    const errObj =
      typeof errNested === "object" && errNested !== null
        ? asPlainObject(errNested)
        : {};
    const errMsg =
      (typeof errObj.message === "string" ? errObj.message : undefined) ||
      (typeof data.message === "string" ? data.message : undefined) ||
      "OpenRouter request failed";
    return {
      ok: false,
      status: input.status,
      error: errMsg,
      model,
    };
  }

  const choices = data.choices;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0
      ? asPlainObject(choices[0])
      : {};
  const messageObj = asPlainObject(firstChoice.message);
  const rawContent = messageObj.content;
  const assistantContent = typeof rawContent === "string" ? rawContent : "";
  const usageRaw = data.usage;
  const usageObj =
    typeof usageRaw === "object" && usageRaw !== null
      ? asPlainObject(usageRaw)
      : null;

  return {
    ok: true,
    status: 200,
    model,
    message: assistantContent || "Sorry, I could not generate a response.",
    usage: usageObj
      ? {
          input_tokens:
            readFiniteNumber(usageObj, "prompt_tokens") ??
            readFiniteNumber(usageObj, "input_tokens"),
          output_tokens:
            readFiniteNumber(usageObj, "completion_tokens") ??
            readFiniteNumber(usageObj, "output_tokens"),
        }
      : undefined,
  };
}
