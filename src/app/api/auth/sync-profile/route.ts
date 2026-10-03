import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { getAuthenticatedUserFromRequest } from "@/lib/apiAuth";
import { syncProfileForUser } from "@/lib/profileSync";
import { toLogSafeError } from "@/lib/logSafeError";

/**
 * POST /api/auth/sync-profile — writes the caller's own public.users row.
 *
 * This file is wiring. Every branch lives in src/lib/profileSync.ts. The id
 * and email written to the row are the values Supabase Auth returns for the
 * verified token. The metadata blob comes from the same user but is
 * user-writable through the Auth API, so it is profile data, not identity. The
 * request body is passed on only for its display names and its optional id
 * check.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Constructed lazily: createAdminClient() throws without the service-role
    // key, and syncProfileForUser checks isSupabaseAdminConfigured() before it
    // reaches either function below.
    let adminClient: SupabaseClient | null = null;
    const admin = (): SupabaseClient => {
      if (!adminClient) {
        adminClient = createAdminClient();
      }
      return adminClient;
    };

    const result = await syncProfileForUser(
      { id: user.id, email: user.email, userMetadata: user.user_metadata },
      body,
      {
        isAdminConfigured: isSupabaseAdminConfigured,

        findExisting: async (userId) => {
          const { data, error } = await admin()
            .from("users")
            .select("first_name, last_name")
            .eq("id", userId)
            .maybeSingle();
          return { row: data ?? null, error };
        },

        upsertProfile: async (payload) => {
          const { error } = await admin()
            .from("users")
            .upsert(payload, { onConflict: "id" });
          if (error) {
            console.error("Profile sync error:", toLogSafeError(error));
          }
          return { error };
        },

        now: () => new Date().toISOString(),
      }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Sync profile API error:", toLogSafeError(error));
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
