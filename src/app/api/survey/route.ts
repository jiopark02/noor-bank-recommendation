import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import { sendSignupConfirmationEmail } from "@/lib/email";
import { claimConfirmationSend } from "@/lib/confirmationSendLimit";
import { sanitizeNameField } from "@/lib/validation";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { toLogSafeError } from "@/lib/logSafeError";
import { createEmailAccount, NAME_REQUIRED_MESSAGE } from "@/lib/emailSignup";
import { decideNameUpdate } from "@/lib/surveyNameUpdate";
import { DEFAULT_FIRST_NAME, firstNameForClient } from "@/lib/defaultFirstName";
import { checkSurveyMoney } from "@/lib/surveyMoney";
import { INVALID_MONTHLY_AMOUNT } from "@/lib/signupCodes";

// Temporary signup pause (fail-open). Gates ONLY the unauthenticated
// email/password signup path below; the authenticated OAuth
// profile-completion path is never affected. Blocks only when SIGNUP_DISABLED
// is exactly "true" — any other value, including unset, leaves signup open, so
// forgetting to remove the variable on resume can never silently close signups.
// This is a temporary launch-gating measure, not a permanent gate.
function isSignupDisabled(): boolean {
  return process.env.SIGNUP_DISABLED === "true";
}

const INVALID_BODY_MESSAGE = "Request body must be a JSON object.";

// The request body as a plain JSON object, or null for anything else: a body
// that does not parse, JSON null, an array, or any other JSON value. Nothing
// about the failure is logged — a parse error's message can quote the input.
async function readJsonObjectBody(
  request: NextRequest
): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

const INVALID_CREDIT_HISTORY_MESSAGE =
  "has_us_credit_history must be true, false or null.";

// Shared survey_responses row mapping. Used by BOTH the unauthenticated signup
// path and the authenticated (OAuth profile-completion) path, so the field
// mapping lives in exactly one place and never drifts between the two.
//
// Only the monthly money answers and the credit-history answer are taken from
// the body; every other body key is ignored. Columns this object does not
// name are not sent with the insert, so a new row gets whatever the table
// itself supplies for them.
function buildSurveyRow(
  userId: string,
  surveyData: Record<string, unknown>,
  now: string
): Record<string, unknown> {
  return {
    id: uuidv4(),
    user_id: userId,
    has_us_credit_history: surveyData.has_us_credit_history ?? null,
    monthly_income: surveyData.monthly_income ?? null,
    expected_monthly_spending:
      surveyData.expected_monthly_spending ??
      surveyData.monthly_budget ??
      null,
    monthly_budget: surveyData.monthly_budget ?? null,
    onboarding_completed: true,
    created_at: now,
    updated_at: now,
  };
}

// Which request-body key(s) each survey_responses column is derived from.
// An UPDATE must be keyed on the ORIGINATING BODY KEY rather than the column
// name, because the two are not interchangeable: `expected_monthly_spending`
// is fed by either of two keys (and today's client sends only the second one),
// and `monthly_budget` feeds two columns. Testing surveyData[column] instead
// would silently drop those. A column absent from this map is never updated.
const UPDATABLE_COLUMN_SOURCE_KEYS: Record<string, string[]> = {
  has_us_credit_history: ["has_us_credit_history"],
  monthly_income: ["monthly_income"],
  expected_monthly_spending: ["expected_monthly_spending", "monthly_budget"],
  monthly_budget: ["monthly_budget"],
};

// Written on every re-submit regardless of what the body contains: reaching
// this route means the survey was completed, and updated_at is set explicitly
// because whether a DB trigger maintains it is not verifiable from this repo.
const ALWAYS_UPDATED_COLUMNS = ["onboarding_completed", "updated_at"];

// Build the UPDATE payload by inclusion rather than by deletion, so a column is
// written only when the caller actually sent something that feeds it. Presence
// of the KEY decides, never the value: that keeps "sent null" (clear this
// field) distinct from "omitted" (leave it alone), which a null-filter cannot
// do. POST refuses any body that is not a plain JSON object before this runs.
// The immutable columns (id, created_at, user_id) are excluded by construction
// — they appear in neither list.
function buildSurveyUpdate(
  surveyRow: Record<string, unknown>,
  surveyData: unknown
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  ALWAYS_UPDATED_COLUMNS.forEach((column) => {
    update[column] = surveyRow[column];
  });

  Object.keys(UPDATABLE_COLUMN_SOURCE_KEYS).forEach((column) => {
    const wasSent = UPDATABLE_COLUMN_SOURCE_KEYS[column].some((key) =>
      Object.prototype.hasOwnProperty.call(surveyData, key)
    );
    if (wasSent) {
      update[column] = surveyRow[column];
    }
  });

  return update;
}

export async function POST(request: NextRequest) {
  try {
    // A Bearer token switches this route into the authenticated
    // profile-completion path (OAuth users, who already have an auth account).
    // Without a token, the email/password signup path runs.
    // Header-only read; does not consume the JSON body.
    const authUserId = await getAuthenticatedUserIdFromRequest(request);

    // Before every other check, on both paths: a body that is not a plain
    // JSON object is 400, with no database read or write and nothing logged.
    const surveyData = await readJsonObjectBody(request);
    if (!surveyData) {
      return NextResponse.json(
        { success: false, message: INVALID_BODY_MESSAGE },
        { status: 400 }
      );
    }

    // The credit-history answer is stored in a boolean column on both paths.
    // When the key is present it must be true, false or null (null clears the
    // stored answer on a re-submit); anything else is 400 here, before any
    // account is created or row written. An absent key is not an error.
    if (
      Object.prototype.hasOwnProperty.call(surveyData, "has_us_credit_history") &&
      surveyData.has_us_credit_history !== true &&
      surveyData.has_us_credit_history !== false &&
      surveyData.has_us_credit_history !== null
    ) {
      return NextResponse.json(
        { success: false, message: INVALID_CREDIT_HISTORY_MESSAGE },
        { status: 400 }
      );
    }

    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Supabase admin is not configured. Set SUPABASE_SERVICE_ROLE_KEY to enable signup.",
        },
        { status: 500 }
      );
    }

    const supabaseAdmin = createAdminClient();
    const now = new Date().toISOString();
    const firstName = sanitizeNameField(surveyData.first_name) || null;
    const lastName = sanitizeNameField(surveyData.last_name) || null;

    if (!authUserId) {
      // ---- UNAUTHENTICATED PATH (email/password signup) ----
      // Every branch lives in src/lib/emailSignup.ts; this is wiring.
      const result = await createEmailAccount(
        {
          email: surveyData.email,
          password: surveyData.password,
          firstName,
          lastName,
          destinationCountry: surveyData.destination_country,
          surveyBody: surveyData,
        },
        {
          isSignupDisabled,

          // Creates the user unconfirmed, or returns an existing unconfirmed
          // one with a new token. Only the hashed token and the user id are
          // read; the action link is not.
          generateSignupLink: async ({ email, password, data }) => {
            const { data: link, error } =
              await supabaseAdmin.auth.admin.generateLink({
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

          // Read-only. A user that does not exist is "no user", not an error;
          // only the email and whether it is confirmed are read.
          getAuthUser: async (userId) => {
            const { data, error } =
              await supabaseAdmin.auth.admin.getUserById(userId);
            if (error) {
              const missing =
                (error as { code?: unknown }).code === "user_not_found" ||
                (error as { status?: unknown }).status === 404;
              return missing ? { user: null, error: null } : { user: null, error };
            }
            const user = data?.user;
            if (!user) return { user: null, error: null };
            return {
              user: {
                email: user.email ?? null,
                emailConfirmed: Boolean(user.email_confirmed_at),
              },
              error: null,
            };
          },

          // The error is returned as PostgREST gave it, so its code (23505
          // decides a branch) reaches the decision.
          insertProfile: async (row) => {
            const { error } = await supabaseAdmin.from("users").insert(row);
            return { error };
          },

          deleteAuthUser: async (userId) => {
            const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
            return { error };
          },

          insertSurveyResponse: async (userId) => {
            const { error } = await supabaseAdmin
              .from("survey_responses")
              .insert(buildSurveyRow(userId, surveyData, now));
            return { error };
          },

          claimConfirmationSend: (userId) =>
            claimConfirmationSend((fn, args) => supabaseAdmin.rpc(fn, args), userId),

          sendConfirmationEmail: sendSignupConfirmationEmail,

          appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://noor.financial",

          findProfileByEmail: async (email) => {
            const { data, error } = await supabaseAdmin
              .from("users")
              .select("id, first_name, last_name")
              .eq("email", email)
              .maybeSingle();
            return {
              row: data
                ? {
                    id: String(data.id),
                    first_name: data.first_name ?? null,
                    last_name: data.last_name ?? null,
                  }
                : null,
              error,
            };
          },

          now: () => now,
        }
      );

      return NextResponse.json(result.body, { status: result.status });
    }

    // ---- AUTHENTICATED PATH (OAuth profile completion) ----
    // Identity comes ONLY from the verified token. Any body id/email/password
    // is ignored. No auth user is created and no password is required.
    const userId = authUserId;

    // A first name that is empty after sanitizing is refused before anything
    // is read or written, with the same answer the signup path gives.
    if (!firstName) {
      return NextResponse.json(
        { success: false, message: NAME_REQUIRED_MESSAGE },
        { status: 400 }
      );
    }

    // Whether a survey row already exists decides how the monthly money
    // answers are checked (and, below, whether the row is updated or
    // inserted), so it is read before anything is written. A refused amount
    // then stops the request with no write at all. The read's error is not
    // examined (as before this check existed): an error reads as "no row",
    // which applies the stricter insert check.
    const { data: existingSurvey } = await supabaseAdmin
      .from("survey_responses")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    const money = checkSurveyMoney(
      surveyData,
      existingSurvey ? "update" : "insert"
    );
    if (!money.ok) {
      return NextResponse.json(
        { success: false, message: money.message, code: INVALID_MONTHLY_AMOUNT },
        { status: 400 }
      );
    }

    // Update the existing users row (sync-profile created it on /auth/callback
    // or after a password sign-in),
    // respecting it: never touch created_at/email. The names are written only
    // when the submitted first name differs from the stored one, as a pair
    // (see decideNameUpdate). The stored names are read first; a failed read
    // stops here rather than guessing, and nothing is written.
    const { data: storedNames, error: lookupError } = await supabaseAdmin
      .from("users")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    if (lookupError) {
      console.error(
        "Profile name lookup error (authenticated survey):",
        toLogSafeError(lookupError)
      );
      return NextResponse.json(
        { success: false, message: "Failed to update user profile record" },
        { status: 500 }
      );
    }

    const profileUpdate: Record<string, unknown> = {
      updated_at: now,
      ...(decideNameUpdate(storedNames, firstName) ?? {}),
    };

    const { error: profileUpdateError } = await supabaseAdmin
      .from("users")
      .update(profileUpdate)
      .eq("id", userId);

    if (profileUpdateError) {
      console.error(
        "Profile update error (authenticated survey):",
        toLogSafeError(profileUpdateError)
      );
      return NextResponse.json(
        { success: false, message: "Failed to update user profile record" },
        { status: 500 }
      );
    }

    // ---- survey_responses write ----
    // Must be idempotent: a signed-in user can revisit /survey and re-submit,
    // and survey_responses.user_id is UNIQUE (survey_responses_user_id_key), so
    // a second insert would 500. If a row already exists we UPDATE it in place
    // (treat re-submit as editing the answers); otherwise we insert. We do NOT
    // use upsert(onConflict): the payload carries a fresh id/created_at that
    // would clobber the existing row's id/created_at on conflict. The UNIQUE
    // index still guards against a concurrent double-submit (the losing insert
    // errors explicitly).
    const surveyRow = buildSurveyRow(userId, surveyData, now);

    let surveyWriteError: { message?: string } | null = null;

    // existingSurvey was read before the users update, above.
    if (existingSurvey) {
      // Update only the mapped columns the request actually carries. Writing
      // all of them would blank every answer the caller omitted.
      const surveyUpdate = buildSurveyUpdate(surveyRow, surveyData);

      const { error } = await supabaseAdmin
        .from("survey_responses")
        .update(surveyUpdate)
        .eq("user_id", userId);
      surveyWriteError = error;
    } else {
      const { error } = await supabaseAdmin
        .from("survey_responses")
        .insert(surveyRow);
      surveyWriteError = error;
    }

    if (surveyWriteError) {
      console.error("Survey write error:", toLogSafeError(surveyWriteError));
      return NextResponse.json(
        {
          success: false,
          message:
            "Account was created, but saving survey data failed. Please contact support.",
          userId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      userId,
      // The first name only: no other body value is echoed back.
      profile: {
        firstName: firstNameForClient(firstName || DEFAULT_FIRST_NAME),
      },
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Survey API error:", toLogSafeError(error));
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
