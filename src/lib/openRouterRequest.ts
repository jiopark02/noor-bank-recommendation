/**
 * openRouterRequest — the one place an OpenRouter chat-completions request is
 * addressed and shaped. The chat route and both memory crons send their
 * requests through these helpers, so a rule that must hold for every LLM call
 * (routing, data handling) is written once, here, and cannot be left out of a
 * single call site.
 *
 * Only the request is shared. Each caller keeps its own fetch, response
 * handling and telemetry, because each route reacts to failure differently.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Reads OPENROUTER_API_KEY. Unset, empty or whitespace-only → null; otherwise
 * the trimmed value.
 */
export function resolveOpenRouterApiKey(): string | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return apiKey.trim();
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterRequestBody {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens: number;
}

export function buildOpenRouterRequestBody(input: {
  model: string;
  messages: OpenRouterMessage[];
  maxTokens: number;
}): OpenRouterRequestBody {
  return {
    model: input.model,
    messages: input.messages,
    max_tokens: input.maxTokens,
  };
}
