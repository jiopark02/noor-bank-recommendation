import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { readRequestJsonWithByteLimit } from "@/lib/boundedRequestJson";
import { claimConfirmationSend } from "@/lib/confirmationSendLimit";
import { sendSignupConfirmationEmail } from "@/lib/email";
import {
  RESEND_MAX_BODY_BYTES,
  resendConfirmation,
} from "@/lib/resendConfirmation";

/**
 * Sends a new signup confirmation link to an account that has not confirmed
 * its email. Unauthenticated; every branch lives in
 * src/lib/resendConfirmation.ts and answers the same body. This file is
 * wiring: the byte limit, the admin gate, and the real dependencies.
 */
export async function POST(request: NextRequest) {
  const read = await readRequestJsonWithByteLimit(request, RESEND_MAX_BODY_BYTES);
  if (read.kind === "too_large") {
    return NextResponse.json(
      { success: false, message: "Request is too large" },
      { status: 413 }
    );
  }

  // Before any read: without the service-role key createAdminClient throws,
  // and that would surface as a fault of the caller's request.
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { success: false, code: "ADMIN_UNCONFIGURED", message: "Please try again later." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://noor.financial";

  const result = await resendConfirmation(read.value, {
    findUserIdByEmail: async (email) => {
      const { data, error } = await admin
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      const id = (data as { id?: unknown } | null)?.id;
      return { userId: typeof id === "string" ? id : null, error };
    },

    getAuthUser: async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const user = data?.user;
      if (error || !user) return { user: null, error };
      return {
        user: {
          email: user.email ?? null,
          emailConfirmed: Boolean(user.email_confirmed_at),
          userMetadata: user.user_metadata ?? {},
        },
        error: null,
      };
    },

    claim: (userId) =>
      claimConfirmationSend((fn, args) => admin.rpc(fn, args), userId),

    // Only the hashed token and the user id are read; the action link is not.
    generateSignupLink: async ({ email, password, data }) => {
      const { data: link, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { data },
      });
      return {
        userId: link?.user?.id ?? null,
        hashedToken: link?.properties?.hashed_token ?? null,
        error,
      };
    },

    sendConfirmationEmail: sendSignupConfirmationEmail,
    appUrl,
  });

  return NextResponse.json(result.body, { status: result.status });
}
