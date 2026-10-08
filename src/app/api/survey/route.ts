import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import { sendWelcomeEmail } from "@/lib/email";
import { sanitizeNameField } from "@/lib/validation";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import { toLogSafeError } from "@/lib/logSafeError";
import { createEmailAccount, NAME_REQUIRED_MESSAGE } from "@/lib/emailSignup";
import { decideNameUpdate } from "@/lib/surveyNameUpdate";
import { DEFAULT_FIRST_NAME, firstNameForClient } from "@/lib/defaultFirstName";

// Temporary signup pause (fail-open). Gates ONLY the unauthenticated
// email/password signup path below; the authenticated OAuth
// profile-completion path is never affected. Blocks only when SIGNUP_DISABLED
// is exactly "true" — any other value, including unset, leaves signup open, so
// forgetting to remove the variable on resume can never silently close signups.
// This is a temporary launch-gating measure, not a permanent gate.
function isSignupDisabled(): boolean {
  return process.env.SIGNUP_DISABLED === "true";
}

// Shared survey_responses row mapping. Used by BOTH the unauthenticated signup
// path and the authenticated (OAuth profile-completion) path, so the field
// mapping lives in exactly one place and never drifts between the two.
function buildSurveyRow(
  userId: string,
  surveyData: Record<string, unknown>,
  now: string
): Record<string, unknown> {
  return {
    id: uuidv4(),
    user_id: userId,
    country_of_origin: surveyData.country_of_origin || null,
    destination_country: surveyData.destination_country || null,
    institution_id: surveyData.institution_id || null,
    institution_type: surveyData.institution_type || null,
    university: surveyData.university || null,
    academic_level: surveyData.academic_level || null,
    year_in_program: surveyData.year_in_program ?? null,
    major: surveyData.major || null,
    gpa: surveyData.gpa ?? null,
    student_level: surveyData.student_level || null,
    has_ssn: surveyData.has_ssn ?? null,
    has_itin: surveyData.has_itin ?? null,
    has_nin: surveyData.has_nin ?? null,
    has_sin: surveyData.has_sin ?? null,
    has_us_credit_history: surveyData.has_us_credit_history ?? null,
    has_us_address: surveyData.has_local_address ?? null,
    monthly_income: surveyData.monthly_income ?? null,
    expected_monthly_spending:
      surveyData.expected_monthly_spending ??
      surveyData.monthly_budget ??
      null,
    fee_sensitivity: surveyData.fee_sensitivity || null,
    monthly_budget: surveyData.monthly_budget ?? null,
    primary_banking_needs: surveyData.banking_needs || null,
    digital_preference: surveyData.digital_preference || null,
    international_transfer_frequency:
      surveyData.international_transfers || null,
    avg_transfer_amount: surveyData.avg_transfer_amount ?? null,
    needs_nearby_branch:
      surveyData.branch_preference === "must"
        ? true
        : surveyData.branch_preference === "not-needed"
        ? false
        : null,
    needs_zelle: surveyData.needs_zelle ?? null,
    prefers_online_banking:
      surveyData.digital_preference === "mobile-first"
        ? true
        : surveyData.digital_preference === "branch-first"
        ? false
        : null,
    preferred_bank_type: surveyData.banking_style || null,
    campus_proximity: surveyData.campus_proximity || null,
    campus_side: surveyData.campus_side || null,
    primary_goals: surveyData.goals || null,
    credit_goals: surveyData.credit_goals || null,
    preferred_language: surveyData.preferred_language || null,
    onboarding_completed: true,
    created_at: now,
    updated_at: now,
  };
}

// Which request-body key(s) each survey_responses column is derived from.
// An UPDATE must be keyed on the ORIGINATING BODY KEY rather than the column
// name, because the two are not interchangeable: seven columns are named
// differently from the key that feeds them, `expected_monthly_spending` is fed
// by either of two keys (and today's client sends only the second one), and
// `digital_preference` / `monthly_budget` each feed two columns. Testing
// surveyData[column] instead would silently drop those.
const UPDATABLE_COLUMN_SOURCE_KEYS: Record<string, string[]> = {
  country_of_origin: ["country_of_origin"],
  destination_country: ["destination_country"],
  institution_id: ["institution_id"],
  institution_type: ["institution_type"],
  university: ["university"],
  academic_level: ["academic_level"],
  year_in_program: ["year_in_program"],
  major: ["major"],
  gpa: ["gpa"],
  student_level: ["student_level"],
  has_ssn: ["has_ssn"],
  has_itin: ["has_itin"],
  has_nin: ["has_nin"],
  has_sin: ["has_sin"],
  has_us_credit_history: ["has_us_credit_history"],
  has_us_address: ["has_local_address"],
  monthly_income: ["monthly_income"],
  expected_monthly_spending: ["expected_monthly_spending", "monthly_budget"],
  fee_sensitivity: ["fee_sensitivity"],
  monthly_budget: ["monthly_budget"],
  primary_banking_needs: ["banking_needs"],
  digital_preference: ["digital_preference"],
  international_transfer_frequency: ["international_transfers"],
  avg_transfer_amount: ["avg_transfer_amount"],
  needs_nearby_branch: ["branch_preference"],
  needs_zelle: ["needs_zelle"],
  prefers_online_banking: ["digital_preference"],
  preferred_bank_type: ["banking_style"],
  campus_proximity: ["campus_proximity"],
  campus_side: ["campus_side"],
  primary_goals: ["goals"],
  credit_goals: ["credit_goals"],
  preferred_language: ["preferred_language"],
};

// Written on every re-submit regardless of what the body contains: reaching
// this route means the survey was completed, and updated_at is set explicitly
// because whether a DB trigger maintains it is not verifiable from this repo.
const ALWAYS_UPDATED_COLUMNS = ["onboarding_completed", "updated_at"];

// Build the UPDATE payload by inclusion rather than by deletion, so a column is
// written only when the caller actually sent something that feeds it. Presence
// of the KEY decides, never the value: that keeps "sent null" (clear this
// field) distinct from "omitted" (leave it alone), which a null-filter cannot
// do. hasOwnProperty returns false rather than throwing for primitive bodies
// (number/string/array); null/undefined throw earlier, at the first_name read.
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

    const surveyData = await request.json();

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
          institutionId: surveyData.institution_id,
          university: surveyData.university,
          countryOfOrigin: surveyData.country_of_origin,
        },
        {
          isSignupDisabled,

          createAuthUser: async (attributes) => {
            const { data, error } =
              await supabaseAdmin.auth.admin.createUser(attributes);
            return { userId: data?.user?.id ?? null, error };
          },

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

          sendWelcomeEmail,

          findProfileByEmail: async (email) => {
            const { data, error } = await supabaseAdmin
              .from("users")
              .select("id")
              .eq("email", email)
              .maybeSingle();
            return { found: !!data, error };
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

    // Update the existing users row (sync-profile created it on callback),
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

    const { data: existingSurvey } = await supabaseAdmin
      .from("survey_responses")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingSurvey) {
      // Update only the columns the request actually carries. Overwriting the
      // whole row would blank every column the caller omitted, which silently
      // destroys answers the current form does not collect.
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
      profile: {
        firstName: firstNameForClient(firstName || DEFAULT_FIRST_NAME),
        lastName,
        institutionId: surveyData.institution_id || null,
        university: surveyData.university || null,
        countryOfOrigin: surveyData.country_of_origin || null,
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
