import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = body?.id;
    const email = (body?.email || "").toLowerCase().trim();
    const firstName = body?.first_name?.trim() || null;
    const lastName = body?.last_name?.trim() || null;
    const rawMeta = body?.raw_user_meta_data || null;

    if (!userId || !email) {
      return NextResponse.json(
        { success: false, message: "id and email are required" },
        { status: 400 }
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

    const { error } = await supabaseAdmin.from("users").upsert(
      {
        id: userId,
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
