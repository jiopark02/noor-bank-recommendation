/**
 * openRouterRequest — the one place an OpenRouter chat-completions request is
 * addressed and shaped. The chat route and both memory crons send their
 * requests through these helpers, so a rule that must hold for every LLM call
 * (routing, data handling) is written once, here, and cannot be left out of a
 * single call site.
 *
 * Only the request is shared. Each caller keeps its own fetch, response
 * handling and telemetry, because each route reacts to failure differently.
 *
 * PROVIDER ROUTING
 * Every request carries OPENROUTER_PROVIDER_PREFERENCES. They are filters on
 * the endpoints OpenRouter may choose for the requested model:
 *   - zdr: only endpoints with a zero-data-retention policy;
 *   - data_collection "deny": only providers that, under OpenRouter's
 *     provider policies, do not collect request data;
 *   - only: provider endpoints whose region tag is in the United States.
 * OpenRouter's own provider fallback (allow_fallbacks, left at its default)
 * still moves between endpoints, but only among those that pass the filters.
 * When no endpoint for the model passes, OpenRouter answers with an error
 * (documented as 503) instead of routing the request elsewhere; the caller treats it
 * like any other failed call. There is deliberately no path that retries
 * without these preferences.
 *
 * The `only` list names region-tagged slugs, not providers: a bare slug such as
 * "google-vertex" would match every region. Whether a given model has an
 * endpoint under these slugs changes over time; the model env vars
 * (OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL, SUMMARY_MODEL,
 * EXTRACTION_MODEL) are how a deployment pins a model that does.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterProviderPreferences {
  readonly zdr: true;
  readonly data_collection: "deny";
  readonly only: readonly string[];
}

export const OPENROUTER_PROVIDER_PREFERENCES: OpenRouterProviderPreferences =
  Object.freeze({
    zdr: true as const,
    data_collection: "deny" as const,
    only: Object.freeze([
      "amazon-bedrock/us",
      "amazon-bedrock/us-east-1",
      "google-vertex/us",
      "google-vertex/us-east5",
    ]),
  });

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
  provider: OpenRouterProviderPreferences;
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
    provider: OPENROUTER_PROVIDER_PREFERENCES,
  };
}
