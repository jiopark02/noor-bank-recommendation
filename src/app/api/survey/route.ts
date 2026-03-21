import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import { sendWelcomeEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const surveyData = await request.json();

    // Validate required fields
    if (!surveyData.email || !surveyData.password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    const email = surveyData.email.toLowerCase().trim();

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
    const firstName = surveyData.first_name?.trim() || "User";
    const lastName = surveyData.last_name?.trim() || null;

    const { data: createdAuthUser, error: createAuthError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: surveyData.password,
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
        },
      });

    if (createAuthError || !createdAuthUser?.user) {
      const message = (createAuthError?.message || "").toLowerCase();
      if (message.includes("already") || message.includes("exists")) {
        return NextResponse.json(
          {
            success: false,
            message: "An account with this email already exists",
          },
          { status: 409 }
        );
      }

      console.error("Supabase auth signup error:", createAuthError);
      return NextResponse.json(
        {
          success: false,
          message: createAuthError?.message || "Failed to create auth user",
        },
        { status: 500 }
      );
    }

    const userId = createdAuthUser.user.id;

    const profileRow = {
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      raw_user_meta_data: {
        source: "survey_signup",
        destination_country: surveyData.destination_country || null,
      },
      created_at: now,
      updated_at: now,
    };

    const { error: profileInsertError } = await supabaseAdmin
      .from("users")
      .insert(profileRow);

    if (profileInsertError) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch((err) => {
        console.error("Rollback delete auth user failed:", err);
      });

      console.error("Profile insert error:", profileInsertError);
      return NextResponse.json(
        { success: false, message: "Failed to create user profile record" },
        { status: 500 }
      );
    }

    const surveyRow = {
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

    const { error: surveyInsertError } = await supabaseAdmin
      .from("survey_responses")
      .insert(surveyRow);

    if (surveyInsertError) {
      console.error("Survey insert error:", surveyInsertError);
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

    sendWelcomeEmail(email, firstName).catch((err) => {
      console.error("Failed to send welcome email:", err);
    });

    return NextResponse.json({
      success: true,
      userId,
      profile: {
        firstName,
        lastName,
        email,
        institutionId: surveyData.institution_id || null,
        university: surveyData.university || null,
        countryOfOrigin: surveyData.country_of_origin || null,
      },
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Survey API error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
