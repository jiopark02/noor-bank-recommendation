import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { sanitizeNameField } from "@/lib/validation";

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
    const firstName = sanitizeNameField(body?.first_name) || null;
    const lastName = sanitizeNameField(body?.last_name) || null;
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

    // Read any existing row so we can respect it on a re-login: never reset
    // created_at, and keep the stored name when the incoming value is empty
    // (a later OAuth login must not wipe a name the user set).
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("first_name, last_name")
      .eq("id", authUserId)
      .maybeSingle();

    // Always use the authenticated user id from the verified token,
    // never a client-supplied id.
    const payload: Record<string, unknown> = {
      id: authUserId,
      email,
      first_name: firstName || existing?.first_name || "User",
      last_name: lastName ?? existing?.last_name ?? null,
      updated_at: now,
    };

    // created_at and the OAuth metadata blob are written only on first insert.
    // Omitting them on update means a routine re-login neither resets the
    // signup date nor re-clobbers raw_user_meta_data every time.
    if (!existing) {
      payload.created_at = now;
      payload.raw_user_meta_data = rawMeta;
    }

    const { error } = await supabaseAdmin
      .from("users")
      .upsert(payload, { onConflict: "id" });

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
