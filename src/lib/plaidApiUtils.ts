import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "./supabase";
import { getAuthenticatedUserIdFromRequest } from "./apiAuth";
import { asPlainObject, readRequestJson } from "@/lib/requestJson";

/**
 * Authenticate Plaid API requests via Supabase Bearer JWT.
 * userId comes only from the token; any client-supplied userId in the body is ignored.
 */
export async function authenticate(
  request: NextRequest
): Promise<{ userId: string; body: Record<string, unknown> } | null> {
  try {
    const userId = await getAuthenticatedUserIdFromRequest(request);
    if (!userId) {
      return null;
    }

    const raw = await readRequestJson(request);
    const body: Record<string, unknown> = { ...asPlainObject(raw) };
    delete body.userId;

    return { userId, body };
  } catch {
    return null;
  }
}

/**
 * Get Plaid connection for a user from database
 */
export async function getPlaidConnection(userId: string) {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error fetching Plaid connection:", error);
    return null;
  }
}

/**
 * Get a single Plaid connection for a user by its item_id.
 *
 * Uses maybeSingle() (not single()): (user_id, item_id) is UNIQUE, so the result
 * is 0 or 1 row and maybeSingle() never errors on "not exactly one" the way
 * single() does when a user has multiple connections. Returns null when the
 * item does not exist for this user.
 */
export async function getPlaidConnectionByItemId(userId: string, itemId: string) {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error fetching Plaid connection by item_id:", error);
    return null;
  }
}

/**
 * Get an active Plaid connection for a user at a given institution, or null.
 *
 * Used for app-level duplicate detection (same user re-linking a bank they
 * already have). Only rows with a matching non-null institution_id are found,
 * so it detects duplicates only among connections created after the
 * institution_id column shipped (pre-existing rows are NULL — see design §5).
 *
 * NOTE: this is UX-grade detection, NOT a security boundary. The institution_id
 * used to call it originates from the client; a forged value only affects the
 * caller's own rows. The persisted institution_id is the server-confirmed value.
 *
 * Throws on a query error so the caller can decide the fail direction
 * (exchange-token fails open — see its call site).
 */
export async function getActivePlaidConnectionByInstitution(
  userId: string,
  institutionId: string
) {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("plaid_connections")
    .select("item_id,institution_name")
    .eq("user_id", userId)
    .eq("institution_id", institutionId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Get all Plaid connections for a user
 */
export async function getAllPlaidConnections(userId: string) {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) {
      return [];
    }

    return data;
  } catch (error) {
    console.error("Error fetching Plaid connections:", error);
    return [];
  }
}

/**
 * Store Plaid connection in database
 */
export async function storePlaidConnection(
  userId: string,
  accessToken: string,
  itemId: string,
  institutionName: string,
  institutionId: string | null
) {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .insert({
        user_id: userId,
        access_token: accessToken,
        item_id: itemId,
        institution_name: institutionName,
        institution_id: institutionId,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      console.error("Error storing Plaid connection:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error storing Plaid connection:", error);
    return null;
  }
}

/**
 * Update Plaid connection status
 */
export async function updatePlaidConnectionStatus(
  userId: string,
  itemId: string,
  status: "active" | "error"
) {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plaid_connections")
      .update({ status })
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .select()
      .single();

    if (error) {
      console.error("Error updating Plaid connection status:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error updating connection status:", error);
    return null;
  }
}

/**
 * Delete Plaid connection
 */
export async function deletePlaidConnection(userId: string, itemId: string) {
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("plaid_connections")
      .delete()
      .eq("user_id", userId)
      .eq("item_id", itemId);

    if (error) {
      console.error("Error deleting Plaid connection:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error deleting connection:", error);
    return false;
  }
}

/**
 * Delete ALL Plaid connections for a user in a single idempotent statement.
 *
 * Used by account deletion. plaid_connections has no FK to public.users and its
 * user_id column is TEXT, so it is not covered by any ON DELETE CASCADE and must
 * be removed explicitly. One filtered delete (not a per-row loop) — removing
 * zero rows is still success, so a retry after a partial failure converges.
 */
export async function deleteAllPlaidConnections(userId: string): Promise<boolean> {
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("plaid_connections")
      .delete()
      .eq("user_id", userId);

    if (error) {
      console.error("Error deleting all Plaid connections:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error deleting all Plaid connections:", error);
    return false;
  }
}

/**
 * Handle common error responses for Plaid API errors
 */
export function handlePlaidError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "An error occurred";

  // Check if it's an ITEM_LOGIN_REQUIRED error
  if (
    message.includes("ITEM_LOGIN_REQUIRED") ||
    message.includes("invalid access token")
  ) {
    return NextResponse.json(
      { error: "Bank connection expired. Please re-link your account." },
      { status: 401 }
    );
  }

  // Check if it's an invalid token error
  if (message.includes("invalid token") || message.includes("unauthorized")) {
    return NextResponse.json(
      { error: "Invalid or expired bank connection." },
      { status: 401 }
    );
  }

  return NextResponse.json(
    { error: message || "An error occurred" },
    { status: 500 }
  );
}
