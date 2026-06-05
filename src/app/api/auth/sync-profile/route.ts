import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";

export async function POST(request: NextRequest) {
  try {
    // --- Authorization: verify the caller's JWT and only allow them to
    // sync THEIR OWN profile row. Without this, anyone could upsert an
    // arbitrary user_id via the service-role client (RLS is bypassed). ---
    const authUserId = await getAuthenticatedUserIdFromRequest(request);
    if (!authUserId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const bodyId = body?.id;
    const email = (body?.email || "").toLowerCase().trim();
    const firstName = body?.first_name?.trim() || null;
    const lastName = body?.last_name?.trim() || null;
    const rawMeta = body?.raw_user_meta_data || null;

    if (!email) {
      return NextResponse.json(
        { success: false, message: "email is required" },
        { status: 400 }
      );
    }

    // Reject attempts to sync a profile for a different user id.
    if (bodyId && bodyId !== authUserId) {
      return NextResponse.json(
        { success: false, message: "Forbidden" },
        { status: 403 }
      );
    }

    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { success: false, message: "Supabase admin is not configured" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createAdminClient();
    const now = new Date().toISOString();

    // Always use the authenticated user id from the verified token,
    // never a client-supplied id.
    const { error } = await supabaseAdmin.from("users").upsert(
      {
        id: authUserId,
        email,
        first_name: firstName || "User",
        last_name: lastName,
        raw_user_meta_data: rawMeta,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error("Profile sync error:", error);
      return NextResponse.json(
        { success: false, message: "Failed to sync user profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Sync profile API error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
}
