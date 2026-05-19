// =============================================================================
// AI Memory Helpers for Noor AI 3-Layer Memory System
//
// This module provides server-side helpers to interact with the four AI memory
// tables (chat_sessions, chat_messages, user_facts, chat_summaries) created in
// the 20260518120000_create_ai_memory_tables migration.
//
// SECURITY NOTE: All functions use the admin client (createAdminClient), which
// BYPASSES Row Level Security. Every query MUST filter by user_id explicitly.
// Never trust user_id values that come from request bodies — always use the
// authenticated user_id from getAuthenticatedUserIdFromRequest().
//
// ERROR HANDLING: Functions throw on failure (fail-fast). Original Supabase /
// PostgrestError objects are preserved via Error.cause so that callers (and
// helpers like isUniqueViolation) can inspect the underlying Postgres error
// code. Route handlers should catch and translate these to HTTP responses.
// =============================================================================

import { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  createAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase";

// -----------------------------------------------------------------------------
// SECTION 1: Type Definitions
// -----------------------------------------------------------------------------

/**
 * A chat session represents one continuous conversation between a user and
 * Noor AI. Multiple messages belong to a session. When a session ends, a
 * summary is generated and stored in chat_summaries.
 */
export interface ChatSession {
  id: string;
  user_id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  last_message_at: string;
  message_count: number;
  summarized: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A single message stored in the database. This is distinct from the client-side
 * ChatMessage (which uses Date objects) and the API ChatMessage (which has no
 * id or timestamp).
 */
export interface DbChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

/**
 * Layer 2: A fact extracted from a conversation. Facts persist across sessions
 * and are injected into future system prompts.
 */
export interface UserFact {
  id: string;
  user_id: string;
  category: UserFactCategory;
  fact: string;
  confidence: number;
  source_message_id: string | null;
  source_session_id: string | null;
  extracted_by_model: string | null;
  status: UserFactStatus;
  superseded_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UserFactCategory =
  | "financial"
  | "personal"
  | "goal"
  | "preference"
  | "visa"
  | "banking"
  | "other";

export type UserFactStatus = "active" | "expired" | "superseded";

/**
 * Layer 3: A compressed summary of a finished conversation session. Used to
 * give Noor AI continuity across sessions without sending all raw messages.
 */
export interface ChatSummary {
  id: string;
  session_id: string;
  user_id: string;
  summary: string;
  topics: string[];
  message_count: number;
  generated_by_model: string | null;
  raw_backup: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input shape for saving a new fact. Most fields default in the database.
 */
export interface NewUserFact {
  category: UserFactCategory;
  fact: string;
  confidence?: number;
  source_message_id?: string;
  source_session_id?: string;
  extracted_by_model?: string;
  expires_at?: string;
}

/**
 * The full 3-layer memory context, built for injection into a system prompt.
 * Layer 1 (survey_responses / UserContext) is built separately in noorAIPrompt.ts.
 */
export interface MemoryContext {
  facts: UserFact[]; // Layer 2
  recentSummaries: ChatSummary[]; // Layer 3
  activeSessionId: string | null;
}

/**
 * Pair of messages (user + assistant) ready to persist. We always save as a
 * pair so the conversation order is preserved atomically.
 */
export interface MessagePairToSave {
  userContent: string;
  assistantContent: string;
  assistantModel?: string;
  inputTokens?: number;
  outputTokens?: number;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Postgres error code for unique constraint violation. Used to detect when
 * a race condition has occurred (e.g., two requests trying to create an
 * active session for the same user at the same time).
 */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Throws a clear error if the admin client cannot be created. Call this at the
 * top of every public function so callers get a useful error message instead
 * of a low-level Supabase failure.
 */
function assertAdminConfigured(): void {
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "Supabase admin client is not configured. " +
        "Set SUPABASE_SERVICE_ROLE_KEY before using aiMemory helpers."
    );
  }
}

/**
 * Returns an admin Supabase client after verifying configuration. All public
 * functions in this module go through this helper.
 */
function getAdmin(): SupabaseClient {
  assertAdminConfigured();
  return createAdminClient();
}

/**
 * Wraps a PostgrestError in a regular Error while preserving the original via
 * Error.cause. Callers and helpers (e.g. isUniqueViolation) can still inspect
 * the original Postgres error code through `(err.cause as PostgrestError).code`.
 *
 * This is critical because Supabase JS surfaces the unique-violation code
 * "23505" only on the raw PostgrestError. Without `cause`, our race-condition
 * retry in getOrCreateActiveSession could not detect concurrent inserts.
 */
function wrapDbError(message: string, cause: PostgrestError | unknown): Error {
  return new Error(message, { cause });
}

/**
 * Detects Postgres unique constraint violations (code 23505), looking at both
 * the error itself and its `cause` chain so wrapped errors still work.
 */
function isUniqueViolation(error: unknown): boolean {
  // Direct case: raw PostgrestError thrown without wrapping.
  if (error && typeof error === "object" && "code" in error) {
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return true;
    }
  }
  // Wrapped case: Error with cause set to a PostgrestError.
  if (error instanceof Error && error.cause && typeof error.cause === "object") {
    const cause = error.cause as { code?: string };
    if (cause.code === PG_UNIQUE_VIOLATION) {
      return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// Feature gate
// -----------------------------------------------------------------------------

/**
 * Returns true when the AI memory subsystem is allowed to read/write Supabase.
 * Route handlers should call this BEFORE invoking any aiMemory function so
 * that the chat endpoint can fall back gracefully when memory is disabled.
 *
 * Two conditions must hold:
 *   1. AI_SUPABASE_READ_ENABLED is "true" (reuses the existing flag from
 *      route.ts:loadReadOnlyUserContextFromSupabase for consistency).
 *   2. The admin client is configured (SUPABASE_SERVICE_ROLE_KEY is set).
 *
 * Inside aiMemory functions themselves we still fail-fast via assertAdminConfigured
 * — this gate is a defense-in-depth check at the call site.
 */
export function isAiMemoryEnabled(): boolean {
  return (
    process.env.AI_SUPABASE_READ_ENABLED === "true" &&
    isSupabaseAdminConfigured()
  );
}

// -----------------------------------------------------------------------------
// SECTION 2: Session Management
// -----------------------------------------------------------------------------

/**
 * Verifies that a session belongs to the given user. Throws if not.
 *
 * SECURITY: Always call this before mutating a session by sessionId. Without
 * it, a caller could pass another user's sessionId and we would silently
 * update/delete their data (admin client bypasses RLS).
 *
 * @throws Error when the session does not exist or belongs to a different user.
 */
export async function assertSessionBelongsToUser(
  sessionId: string,
  userId: string
): Promise<void> {
  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw wrapDbError(
      `Failed to verify session ownership: ${error.message}`,
      error
    );
  }
  if (!data) {
    throw new Error(
      `Session ${sessionId} does not belong to user ${userId} or does not exist`
    );
  }
}

/**
 * Returns the user's current active session, or null if none exists.
 * "Active" means ended_at IS NULL.
 *
 * Thanks to the partial unique index ux_chat_sessions_one_active_per_user,
 * there is at most one active session per user at any time.
 *
 * @throws Error when the database query fails.
 */
export async function getActiveSession(
  userId: string
): Promise<ChatSession | null> {
  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw wrapDbError(`Failed to fetch active session: ${error.message}`, error);
  }
  return (data as ChatSession | null) ?? null;
}

/**
 * Creates a new chat session for the user. Will fail with a unique violation
 * (Postgres code 23505) if the user already has an active session — the
 * partial unique index `ux_chat_sessions_one_active_per_user` guarantees this.
 *
 * PREFER {@link getOrCreateActiveSession} in route handlers. Use this directly
 * only when you have already verified that no active session exists (for
 * example, in an admin/cron context that just closed all stale sessions).
 *
 * @throws Error wrapping the underlying PostgrestError (cause preserved so
 *   isUniqueViolation works on the thrown error).
 */
export async function createSession(userId: string): Promise<ChatSession> {
  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error) {
    throw wrapDbError(`Failed to create session: ${error.message}`, error);
  }
  return data as ChatSession;
}

/**
 * Returns the user's active session, creating one if none exists.
 *
 * Handles the race condition where two concurrent requests both see "no active
 * session" and try to create one. The partial unique index prevents the second
 * insert; we catch the unique violation (via the preserved cause chain), then
 * re-fetch the session the other request created.
 *
 * @throws Error when the database query fails or when an unexpected state is
 *   reached (unique violation but no active session found on retry).
 */
export async function getOrCreateActiveSession(
  userId: string
): Promise<ChatSession> {
  // Fast path: an active session already exists.
  const existing = await getActiveSession(userId);
  if (existing) return existing;

  // Slow path: try to create one.
  try {
    return await createSession(userId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Another request created an active session between our SELECT and
      // INSERT. Re-fetch and return that one.
      const session = await getActiveSession(userId);
      if (session) return session;
      // Extremely unlikely: unique violation but no active session found.
      // This would mean the session was created and immediately ended.
      throw new Error(
        "Unique violation on chat_sessions but no active session found on retry",
        { cause: error }
      );
    }
    throw error;
  }
}

/**
 * Closes a session by setting its ended_at timestamp. Idempotent: calling
 * this on an already-closed session is a no-op (ended_at stays the same).
 *
 * SECURITY: Verifies session ownership before mutation.
 *
 * @throws Error when the session does not belong to the user, does not exist,
 *   or when the database query fails.
 */
export async function endSession(
  sessionId: string,
  userId: string
): Promise<ChatSession> {
  await assertSessionBelongsToUser(sessionId, userId);

  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("ended_at", null) // Only update if still active (idempotent)
    .select("*")
    .maybeSingle();

  if (error) {
    throw wrapDbError(`Failed to end session: ${error.message}`, error);
  }
  if (!data) {
    // Session was already closed. Re-fetch to return the current state.
    const { data: existing, error: fetchError } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();
    if (fetchError) {
      throw wrapDbError(
        `Failed to fetch closed session: ${fetchError.message}`,
        fetchError
      );
    }
    return existing as ChatSession;
  }
  return data as ChatSession;
}

// -----------------------------------------------------------------------------
// SECTION 3: Message Storage & Retrieval
// -----------------------------------------------------------------------------
//
// Uses types and helpers already defined in earlier sections:
//   - getAdmin(), wrapDbError(), assertSessionBelongsToUser(), getActiveSession()
//   - DbChatMessage, MessagePairToSave
// -----------------------------------------------------------------------------

/**
 * Options for retrieving messages from a session.
 */
export interface GetSessionMessagesOptions {
  /** Maximum number of messages to return. Defaults to 50. */
  limit?: number;
  /**
   * Sort order by created_at. Defaults to "asc" (oldest first) which matches
   * how the client renders conversation history. Use "desc" when fetching
   * just the most-recent N messages for context-window trimming.
   */
  order?: "asc" | "desc";
}

const DEFAULT_MESSAGES_LIMIT = 50;

/**
 * Persists a user message and the assistant reply that followed it. Always
 * called as a pair so the conversation order is preserved.
 *
 * SECURITY:
 *   - Verifies session ownership before inserting (admin client bypasses RLS).
 *   - The user_id stored on both rows is the authenticated userId passed in,
 *     not anything from the request body. Never accept user_id from client.
 *
 * DB SIDE EFFECTS:
 *   - The bump_chat_session_on_message trigger automatically increments
 *     chat_sessions.message_count and updates last_message_at for each row
 *     inserted. Do NOT update these columns here.
 *
 * @param sessionId   Target session id (must belong to userId).
 * @param userId      Authenticated user id.
 * @param pair        User content + assistant content + optional model/usage.
 * @returns           The two inserted rows ({ userMessage, assistantMessage }).
 *                    Returned rows are matched by `role` (not array index) so
 *                    this is robust to any ordering surprises from PostgREST.
 *                    The ids on the returned rows are useful as
 *                    source_message_id for facts.
 *
 * @throws Error when the session does not belong to the user, the user/
 *   assistant content is empty, the insert returns an unexpected shape, or
 *   the database insert fails.
 */
export async function saveMessages(
  sessionId: string,
  userId: string,
  pair: MessagePairToSave
): Promise<{
  userMessage: DbChatMessage;
  assistantMessage: DbChatMessage;
}> {
  // Validate inputs early — empty content is almost always a caller bug.
  if (!pair.userContent || pair.userContent.trim() === "") {
    throw new Error("saveMessages: userContent must be a non-empty string");
  }
  if (!pair.assistantContent || pair.assistantContent.trim() === "") {
    throw new Error("saveMessages: assistantContent must be a non-empty string");
  }

  // SECURITY: verify ownership before any insert.
  await assertSessionBelongsToUser(sessionId, userId);

  const supabase = getAdmin();

  // Insert both rows in one statement. PostgreSQL guarantees atomicity for a
  // multi-row INSERT, so we either get both rows or neither.
  //
  // Note: input_tokens/output_tokens/model live ONLY on the assistant row.
  // The trigger bump_chat_session_on_message will fire twice (once per row)
  // and bump message_count by 2, which is the intended per-turn behavior.
  const { data, error } = await supabase
    .from("chat_messages")
    .insert([
      {
        session_id: sessionId,
        user_id: userId,
        role: "user",
        content: pair.userContent,
      },
      {
        session_id: sessionId,
        user_id: userId,
        role: "assistant",
        content: pair.assistantContent,
        model: pair.assistantModel ?? null,
        input_tokens: pair.inputTokens ?? null,
        output_tokens: pair.outputTokens ?? null,
      },
    ])
    .select("*");

  if (error) {
    throw wrapDbError(`Failed to save messages: ${error.message}`, error);
  }
  if (!data || data.length !== 2) {
    throw new Error(
      `saveMessages: expected 2 inserted rows, got ${data?.length ?? 0}`
    );
  }

  // Match returned rows by role rather than relying on array index. PostgREST
  // generally preserves input order, but matching by role is more defensive
  // and survives any version/config differences.
  const rows = data as DbChatMessage[];
  const userMessage = rows.find((r) => r.role === "user");
  const assistantMessage = rows.find((r) => r.role === "assistant");
  if (!userMessage || !assistantMessage) {
    throw new Error(
      "saveMessages: inserted rows missing expected user/assistant roles"
    );
  }

  return { userMessage, assistantMessage };
}

/**
 * Returns messages for a session, ordered by created_at.
 *
 * SECURITY: Filters by both session_id AND user_id to defend against the case
 * where a caller passes another user's sessionId. We don't call
 * assertSessionBelongsToUser here because (a) this is a read, and (b) the
 * combined filter naturally returns [] for unauthorized requests — which is
 * the same behavior as a session that simply has no messages yet.
 *
 * @param sessionId  Session to read messages from.
 * @param userId     Authenticated user id (used as an authorization filter).
 * @param options    Optional limit and sort order. See GetSessionMessagesOptions.
 * @returns          Array of messages. Empty when the session does not exist,
 *                   does not belong to userId, or has no messages.
 *
 * @throws Error when the database query fails.
 */
export async function getSessionMessages(
  sessionId: string,
  userId: string,
  options: GetSessionMessagesOptions = {}
): Promise<DbChatMessage[]> {
  const limit = options.limit ?? DEFAULT_MESSAGES_LIMIT;
  const order = options.order ?? "asc";

  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: order === "asc" })
    .limit(limit);

  if (error) {
    throw wrapDbError(
      `Failed to fetch session messages: ${error.message}`,
      error
    );
  }
  return (data ?? []) as DbChatMessage[];
}

/**
 * Returns the most recent N messages for a user's active session, in
 * chronological order (oldest first). Convenience wrapper used by route.ts
 * when building the LLM context window without sending the entire history.
 *
 * Returns an empty array if the user has no active session.
 *
 * @throws Error when the database query fails.
 */
export async function getRecentMessagesForActiveSession(
  userId: string,
  limit: number = DEFAULT_MESSAGES_LIMIT
): Promise<DbChatMessage[]> {
  const session = await getActiveSession(userId);
  if (!session) return [];

  // Fetch the most-recent N messages (desc), then reverse to chronological.
  const recent = await getSessionMessages(session.id, userId, {
    limit,
    order: "desc",
  });
  return recent.reverse();
}
