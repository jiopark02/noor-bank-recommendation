"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  validatePassword,
  validateEmail,
  getPasswordStrengthColor,
  getPasswordStrengthLabel,
  createSession,
  acceptTerms,
} from "@/lib/validation";
import {
  supabase,
  getSessionSafe,
  readSession,
} from "@/lib/supabase-browser";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import type { Session } from "@supabase/supabase-js";
import { COUNTRY_DISPLAY } from "@/lib/countryConfig";

interface SurveyData {
  firstName: string;
  email: string;
  password: string;
  confirmPassword: string;
  staySignedIn: boolean;
  agreeToTerms: boolean;
  // Not asked on this form: read from localStorage, and used only to pick the
  // currency symbol shown beside the money inputs.
  destinationCountry: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  // undefined means "not answered", which is distinct from yes and from no.
  // JSON.stringify omits undefined-valued keys, so an unanswered question sends
  // no key at all and the stored column is left untouched.
  hasUsCreditHistory: boolean | undefined;
}

const INITIAL_DATA: SurveyData = {
  firstName: "",
  email: "",
  password: "",
  confirmPassword: "",
  staySignedIn: false,
  agreeToTerms: false,
  destinationCountry: "",
  monthlyIncome: 0,
  monthlyExpenses: 0,
  hasUsCreditHistory: undefined,
};

// Currency display only. Recommendation logic does not read this.
const COUNTRY_CONFIG = {
  US: {
    currency: COUNTRY_DISPLAY.US.currencySymbol,
    currencyCode: COUNTRY_DISPLAY.US.currency,
  },
  UK: {
    currency: COUNTRY_DISPLAY.UK.currencySymbol,
    currencyCode: COUNTRY_DISPLAY.UK.currency,
  },
  CA: {
    currency: COUNTRY_DISPLAY.CA.currencySymbol,
    currencyCode: COUNTRY_DISPLAY.CA.currency,
  },
};

// Input Component - MUST be outside the main component to prevent re-renders
const Input = ({
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  required,
}: {
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
}) => (
  <div className="space-y-1">
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-4 py-3.5 border rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400 ${
          error ? "border-red-300 bg-red-50" : "border-gray-200"
        }`}
      />
      {required && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-sm">
          *
        </span>
      )}
    </div>
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
);

// Password Input with show/hide toggle
const PasswordInput = ({
  value,
  onChange,
  placeholder,
  error,
  showStrength,
  strengthData,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  showStrength?: boolean;
  strengthData?: {
    strength: "weak" | "medium" | "strong";
    score: number;
    checks: Record<string, boolean>;
  };
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full px-4 py-3.5 pr-12 border rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400 ${
            error ? "border-red-300 bg-red-50" : "border-gray-200"
          }`}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {showPassword ? (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {showStrength && strengthData && value.length > 0 && (
        <div className="space-y-2">
          {/* Strength bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  backgroundColor: getPasswordStrengthColor(
                    strengthData.strength
                  ),
                }}
                initial={{ width: 0 }}
                animate={{ width: `${strengthData.score}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <span
              className="text-xs font-medium"
              style={{ color: getPasswordStrengthColor(strengthData.strength) }}
            >
              {getPasswordStrengthLabel(strengthData.strength)}
            </span>
          </div>
          {/* Checklist */}
          <div className="grid grid-cols-2 gap-1 text-xs">
            {[
              { key: "minLength", label: "8+ characters" },
              { key: "hasUppercase", label: "Uppercase (A-Z)" },
              { key: "hasLowercase", label: "Lowercase (a-z)" },
              { key: "hasNumber", label: "Number (0-9)" },
              { key: "hasSpecial", label: "Special (!@#$%)" },
            ].map((item) => (
              <div
                key={item.key}
                className={`flex items-center gap-1 ${
                  strengthData.checks[
                    item.key as keyof typeof strengthData.checks
                  ]
                    ? "text-emerald-600"
                    : "text-gray-400"
                }`}
              >
                {strengthData.checks[
                  item.key as keyof typeof strengthData.checks
                ] ? (
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="10" strokeWidth={2} />
                  </svg>
                )}
                {item.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Toggle Button (Yes/No)
const ToggleButtons = ({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) => (
  <div className="flex gap-3">
    <button
      onClick={() => onChange(true)}
      className={`flex-1 py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
        value === true
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
      }`}
    >
      Yes
    </button>
    <button
      onClick={() => onChange(false)}
      className={`flex-1 py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
        value === false
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
      }`}
    >
      No
    </button>
  </div>
);

// Money Input - handles leading zeros properly
const MoneyInput = ({
  value,
  onChange,
  placeholder = "0",
  currencySymbol = "$",
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  currencySymbol?: string;
}) => {
  const [text, setText] = React.useState(() =>
    value > 0 ? String(value) : ""
  );

  // Sync when parent value changes
  React.useEffect(() => {
    setText(value > 0 ? String(value) : "");
  }, [value]);

  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
        {currencySymbol}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onKeyDown={(e) => {
          // Block "0" key when field is empty (prevents leading zeros)
          if (e.key === "0" && text === "") {
            e.preventDefault();
            return;
          }
          // Only allow digits and control keys
          if (
            !/^\d$/.test(e.key) &&
            !["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab"].includes(
              e.key
            )
          ) {
            e.preventDefault();
          }
        }}
        onChange={(e) => {
          // Get raw value and strip any non-digits and leading zeros
          const raw = e.target.value.replace(/\D/g, "").replace(/^0+/, "");
          setText(raw);
          onChange(raw ? parseInt(raw, 10) : 0);
        }}
        className="w-full pl-8 pr-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black"
      />
    </div>
  );
};

// "You opened this" marker beside a policy link. Display only — deliberately
// NOT part of any submit condition. Having opened a document is not consent,
// and gating submission on it would only add friction without adding proof.
const ViewedMark = () => (
  <svg
    className="inline-block w-3 h-3 ml-0.5 -mt-0.5 text-emerald-600"
    fill="currentColor"
    viewBox="0 0 20 20"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
      clipRule="evenodd"
    />
  </svg>
);

export default function SurveyPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [data, setData] = useState<SurveyData>(INITIAL_DATA);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // True when the user reaches /survey already authenticated (e.g. OAuth
  // profile completion). In that case we skip account creation and the password
  // fields, and submit the survey against their existing token.
  const [isAuthed, setIsAuthed] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  // Read markers only. See ViewedMark.
  const [termsViewed, setTermsViewed] = useState(false);
  const [privacyViewed, setPrivacyViewed] = useState(false);

  // Validation states
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Get country config
  const countryConfig =
    COUNTRY_CONFIG[data.destinationCountry as keyof typeof COUNTRY_CONFIG] ||
    COUNTRY_CONFIG.US;

  // Load destination country from localStorage. This form does not ask for it;
  // /welcome is where it gets chosen. Every fallback path lands on US, so the
  // money inputs never render a wrong currency symbol.
  useEffect(() => {
    const savedCountry = localStorage.getItem("noor_selected_country");
    if (
      savedCountry &&
      (savedCountry === "US" || savedCountry === "UK" || savedCountry === "CA")
    ) {
      setData((prev) => ({ ...prev, destinationCountry: savedCountry }));
    } else {
      // Default to US if not set
      setData((prev) => ({ ...prev, destinationCountry: "US" }));
    }
  }, []);

  // Detect an existing session so OAuth users can complete their profile
  // without re-entering a password. Prefill the identity fields we already know.
  //
  // The mount-time read alone is not enough: getSessionSafe() resolves to null
  // on a 3s timeout as well as on a real absence of session, and the two are
  // indistinguishable here. A slow token refresh therefore used to pin isAuthed
  // at false for the lifetime of the page, pushing an already-authenticated
  // retake into the signup path. Pairing the read with an onAuthStateChange
  // subscription (same combination as ClientLayout) lets a session that arrives
  // late still be adopted.
  useEffect(() => {
    let mounted = true;

    // Adoption is deliberately one-way: it only ever turns isAuthed on. A null
    // session is ignored rather than clearing the flag, so a refresh landing
    // mid-submit cannot flip the form back to the account-creation path.
    const adoptSession = (nextSession: Session | null) => {
      if (!mounted || !nextSession?.user) return;
      const session = nextSession;
      setIsAuthed(true);
      let stored: Record<string, unknown> = {};
      try {
        stored = JSON.parse(localStorage.getItem("noor_user_profile") || "{}");
      } catch {
        stored = {};
      }
      setData((prev) => ({
        ...prev,
        email: session.user.email || prev.email,
        firstName: prev.firstName || (stored.firstName as string) || "",
      }));
    };

    const syncSession = async () => {
      adoptSession(await getSessionSafe());
    };

    syncSession();

    const { data: authListener } = supabase?.auth.onAuthStateChange(
      (_event, session) => {
        adoptSession(session);
      }
    ) || { data: { subscription: null } };

    return () => {
      mounted = false;
      authListener.subscription?.unsubscribe();
    };
  }, []);

  // Password validation
  const passwordValidation = useMemo(() => {
    return validatePassword(data.password);
  }, [data.password]);

  // Check if passwords match
  const passwordsMatch =
    data.password === data.confirmPassword && data.confirmPassword.length > 0;

  // Update email validation state
  useEffect(() => {
    if (data.email && touchedFields.has("email")) {
      const validation = validateEmail(data.email);
      if (!validation.isValid) {
        setErrors((prev) => ({ ...prev, email: validation.error }));
      } else {
        setErrors((prev) => ({ ...prev, email: null }));
        setEmailSuggestion(validation.suggestion);
      }
    }
  }, [data.email, touchedFields]);

  // Mark field as touched
  const markTouched = (field: string) => {
    setTouchedFields((prev) => new Set(prev).add(field));
  };

  const updateField = <K extends keyof SurveyData>(
    field: K,
    value: SurveyData[K]
  ) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    // Second layer of the consent gate. The disabled attribute on the button is
    // UI only and can be stripped from the browser, so re-check before any
    // network call. This runs before setIsSubmitting so a rejected submit never
    // leaves the form locked.
    if (!data.agreeToTerms) {
      setSubmitError(
        "Please accept the Terms of Service and Privacy Policy to continue."
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // Authenticated (OAuth) completion submits with a Bearer token, which the
      // /api/survey route uses to skip account creation. Unauthenticated signup
      // posts without a token — unchanged behavior.
      //
      // This screen deliberately does NOT use getSupabaseBearerHeaders() on the
      // authenticated path. That helper returns {} when it cannot get a token,
      // which lets the request go out with no Authorization header at all; the
      // route then reads it as an anonymous signup and answers with a signup
      // error. That is exactly the failure this guard exists to prevent, and it
      // happened in production.
      //
      // The helper itself is left alone on purpose — it has 22 call sites, and
      // changing its return contract would touch all of them. So the divergence
      // lives here instead: read the session directly, and if no token can be
      // obtained, do not send the request at all. If getSupabaseBearerHeaders()
      // is ever changed to fail loudly on a missing token, this detour becomes
      // redundant and should be folded back into it.
      let surveyHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (isAuthed) {
        let read = await readSession(3000, "survey-submit");

        // "unavailable" means the read never answered — a timeout or a failed
        // token refresh — not that the user is signed out, so it is worth one
        // more try. "none" is an actual answer, so retrying it would only
        // repeat itself. The retry runs on a shorter budget to bound how long
        // the button can sit spinning before the user hears anything.
        if (read.status === "unavailable") {
          await new Promise((resolve) => setTimeout(resolve, 300));
          read = await readSession(1500, "survey-submit-retry", 2);
        }

        const accessToken =
          read.status === "session" ? read.session.access_token : null;

        if (!accessToken) {
          // Deliberately does not claim the session expired. It may not have:
          // a valid cookie session can produce this, and saying "you were
          // signed out" would be a guess presented as fact.
          setSubmitError(
            "We couldn't confirm your sign-in just now, so your answers weren't submitted. Your answers are still here — please try again in a moment."
          );
          return;
        }

        surveyHeaders = buildJsonAuthorizedHeaders({
          Authorization: `Bearer ${accessToken}`,
        });
      }

      // Every key below gets written to the database. The server decides what to
      // UPDATE by testing whether the KEY is present, not whether its value is
      // meaningful, so a key carrying null overwrites the stored column. Fields
      // this form no longer asks about therefore have their keys deleted here
      // rather than sent as null, undefined or "".
      //
      // The credit-history key below is the one that may hold undefined, and
      // that is deliberate: JSON.stringify omits undefined-valued keys entirely,
      // so "not answered" arrives as an absent key and leaves the column alone.
      //
      // monthly_budget must stay: it feeds both monthly_budget and
      // expected_monthly_spending, and the chat prompt reads the latter.
      const response = await fetch("/api/survey", {
        method: "POST",
        headers: surveyHeaders,
        body: JSON.stringify({
          first_name: data.firstName,
          email: data.email,
          password: data.password,
          monthly_income: data.monthlyIncome,
          monthly_budget: data.monthlyExpenses,
          has_us_credit_history: data.hasUsCreditHistory,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        setSubmitError(
          result.message || "Failed to create account. Please try again."
        );
        return;
      }

      // Create a Supabase auth session immediately after successful signup.
      // Skipped for the authenticated path — that user is already signed in.
      if (!isAuthed && supabase) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: data.email.trim().toLowerCase(),
          password: data.password,
        });

        if (signInError) {
          console.error("Post-signup sign-in error:", signInError);
          setSubmitError(
            "Account created, but automatic sign-in failed. Please log in manually."
          );
          return;
        }
      }

      // Save user ID and create session
      localStorage.setItem("noor_user_id", result.userId);
      createSession(isAuthed ? true : data.staySignedIn);
      // Third layer of the consent gate, and the only one that is not UI: a user
      // who did not tick the box gets no acceptance record written at all.
      if (data.agreeToTerms) acceptTerms();
      // Writer for the onboarding cache (previously a ghost key nothing set):
      // the survey is now complete. callback also fills this from the DB.
      localStorage.setItem("noor_onboarding_completed", "true");

      // Merge over the cached profile rather than replacing it. Settings is the
      // only writer for the school fields now, and re-submitting this form must
      // not erase what it stored. result.profile is deliberately not spread
      // wholesale: with the school keys gone from the request it comes back with
      // those fields set to null, which would clobber them.
      let priorProfile: Record<string, unknown> = {};
      try {
        priorProfile = JSON.parse(
          localStorage.getItem("noor_user_profile") || "{}"
        );
      } catch {
        priorProfile = {};
      }

      const userProfile = {
        ...priorProfile,
        id: result.userId,
        firstName: result.profile?.firstName ?? data.firstName,
        email: isAuthed ? data.email : result.profile?.email ?? data.email,
        destinationCountry: data.destinationCountry,
        currency: countryConfig.currencyCode,
        monthlyIncome: data.monthlyIncome,
        monthlyExpenses: data.monthlyExpenses,
      };
      localStorage.setItem("noor_user_profile", JSON.stringify(userProfile));

      router.push(isAuthed ? "/dashboard" : "/");
    } catch (error) {
      console.error("Survey submission error:", error);
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="pt-8 pb-4 text-center">
        <span className="text-xs tracking-[0.3em] font-medium text-gray-400">
          NOOR
        </span>
      </header>

      <div className="max-w-md mx-auto px-6 pb-32">
        <div className="animate-fade-in">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">
            {t("survey.step1.title")}
          </h1>
          <p className="text-gray-500 mb-8">{t("survey.step1.subtitle")}</p>

          <div className="space-y-4">
            <Input
              placeholder={t("survey.step1.firstName")}
              value={data.firstName}
              onChange={(v) => updateField("firstName", v)}
              error={
                touchedFields.has("firstName") && !data.firstName
                  ? t("errors.required")
                  : null
              }
              required
            />

            {/* Email with validation */}
            <div className="space-y-1">
              <Input
                type="email"
                placeholder={t("survey.step1.email")}
                value={data.email}
                onChange={(v) => {
                  updateField("email", v);
                  markTouched("email");
                }}
                error={touchedFields.has("email") ? errors.email : null}
                required
              />
              {emailSuggestion && (
                <button
                  onClick={() => {
                    const corrected = emailSuggestion
                      .replace("Did you mean ", "")
                      .replace("?", "");
                    updateField("email", corrected);
                    setEmailSuggestion(null);
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {emailSuggestion}
                </button>
              )}
            </div>

            {/* Password + confirm create the account credentials. Hidden for an
                already-authenticated user (OAuth profile completion), since no
                new auth account is being created. */}
            {!isAuthed && (
              <>
                {/* Password with strength indicator */}
                <PasswordInput
                  placeholder={t("survey.password.placeholder")}
                  value={data.password}
                  onChange={(v) => {
                    updateField("password", v);
                    markTouched("password");
                  }}
                  showStrength={true}
                  strengthData={passwordValidation}
                />

                {/* Confirm password with match indicator */}
                <div className="space-y-1">
                  <PasswordInput
                    placeholder={t("survey.password.confirm")}
                    value={data.confirmPassword}
                    onChange={(v) => {
                      updateField("confirmPassword", v);
                      markTouched("confirmPassword");
                    }}
                  />
                  {touchedFields.has("confirmPassword") &&
                    data.confirmPassword && (
                      <div
                        className={`flex items-center gap-1 text-xs ${
                          passwordsMatch ? "text-emerald-600" : "text-red-500"
                        }`}
                      >
                        {passwordsMatch ? (
                          <>
                            <svg
                              className="w-3 h-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                            {t("survey.password.match")}
                          </>
                        ) : (
                          <>
                            <svg
                              className="w-3 h-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                            {t("survey.password.noMatch")}
                          </>
                        )}
                      </div>
                    )}
                </div>
              </>
            )}

            {/* Money in */}
            <div className="pt-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("survey.step4.income")}{" "}
                <span className="text-gray-400">
                  ({countryConfig.currencyCode})
                </span>
                <span className="text-red-400 ml-1">*</span>
              </label>
              <MoneyInput
                value={data.monthlyIncome}
                onChange={(v) => updateField("monthlyIncome", v)}
                currencySymbol={countryConfig.currency}
              />
              <p className="text-gray-400 text-xs mt-1.5">
                {t("survey.step4.incomeHint")}
              </p>
            </div>

            {/* Money out */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("survey.step4.expenses")}{" "}
                <span className="text-gray-400">
                  ({countryConfig.currencyCode})
                </span>
                <span className="text-red-400 ml-1">*</span>
              </label>
              <MoneyInput
                value={data.monthlyExpenses}
                onChange={(v) => updateField("monthlyExpenses", v)}
                currencySymbol={countryConfig.currency}
              />
              <p className="text-gray-400 text-xs mt-1.5">
                {t("survey.step4.expensesHint")}
              </p>
            </div>

            {/* Credit history. Optional: leaving it blank is a real answer
                ("don't know") and is stored as no answer at all, which is why
                there is no third button for it. Copy is English on purpose — no
                message catalogue carries this string, and a missing key would
                render as the raw key path. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Do you have a credit history in the US?
              </label>
              <p className="text-gray-400 text-xs mb-3">
                Optional — leave this blank if you are not sure.
              </p>
              <ToggleButtons
                value={data.hasUsCreditHistory ?? null}
                onChange={(v) => updateField("hasUsCreditHistory", v)}
              />
            </div>

            {/* Stay signed in */}
            <label className="flex items-center gap-3 py-2 cursor-pointer">
              <div
                onClick={() => updateField("staySignedIn", !data.staySignedIn)}
                className={`w-5 h-5 rounded border-[1.5px] flex items-center justify-center transition-all duration-300 ${
                  data.staySignedIn ? "bg-black border-black" : "border-gray-300"
                }`}
              >
                {data.staySignedIn && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <span className="text-sm text-gray-600">
                {t("survey.step1.staySignedIn")}
              </span>
            </label>

            {/* Terms & Privacy — standard clickwrap: ticking the box is the
                consent, and each policy opens in its own titled modal. */}
            <label className="flex items-start gap-3 py-2 cursor-pointer">
              <div
                onClick={() => updateField("agreeToTerms", !data.agreeToTerms)}
                className={`w-5 h-5 mt-0.5 rounded border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                  data.agreeToTerms ? "bg-black border-black" : "border-gray-300"
                }`}
              >
                {data.agreeToTerms && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <span className="text-sm text-gray-600">
                {t("survey.step1.agreeToTerms")}{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTermsModal(true);
                    setTermsViewed(true);
                  }}
                  className="text-black underline hover:opacity-70"
                >
                  {t("survey.terms.title")}
                </button>
                {termsViewed && <ViewedMark />}{" "}
                {t("common.and")}{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPrivacyModal(true);
                    setPrivacyViewed(true);
                  }}
                  className="text-black underline hover:opacity-70"
                >
                  {t("survey.privacy.title")}
                </button>
                {privacyViewed && <ViewedMark />}
                <span className="text-red-400 ml-1">*</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Terms Modal */}
      <AnimatePresence>
        {showTermsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">
                    {t("survey.terms.title")}
                  </h2>
                  <button
                    onClick={() => setShowTermsModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <div className="prose prose-sm text-gray-600">
                  <p className="mb-4">Last updated: January 2026</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    1. Acceptance of Terms
                  </h3>
                  <p className="mb-4">
                    By accessing and using Noor, you accept and agree to be
                    bound by these Terms of Service. If you do not agree to
                    these terms, please do not use our service.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    2. Description of Service
                  </h3>
                  <p className="mb-4">
                    Noor provides financial guidance, banking recommendations,
                    and tools. Our recommendations are for informational
                    purposes only and do not constitute financial advice.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    3. User Responsibilities
                  </h3>
                  <p className="mb-4">
                    You are responsible for maintaining the confidentiality of
                    your account and password. You agree to provide accurate
                    information and to update your information as necessary.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    4. Privacy
                  </h3>
                  <p className="mb-4">
                    Your privacy is important to us. Please review our Privacy
                    Policy to understand how we collect, use, and protect your
                    information.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    5. Limitation of Liability
                  </h3>
                  <p className="mb-4">
                    Noor is not liable for any financial decisions made based on
                    our recommendations. Always consult with a qualified
                    financial advisor for personalized advice.
                  </p>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100">
                <button
                  onClick={() => setShowTermsModal(false)}
                  className="w-full py-3 bg-black text-white rounded-xl font-medium"
                >
                  {t("common.close")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy Modal */}
      <AnimatePresence>
        {showPrivacyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">
                    {t("survey.privacy.title")}
                  </h2>
                  <button
                    onClick={() => setShowPrivacyModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <div className="prose prose-sm text-gray-600">
                  <p className="mb-4">Last updated: January 2026</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    What We Collect
                  </h3>
                  <p className="mb-4">
                    We collect information you provide directly to us, including
                    your name, email address, university, visa status, and
                    financial preferences.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    How We Use Your Information
                  </h3>
                  <p className="mb-4">
                    We use your information to provide personalized banking
                    recommendations, send relevant updates and notifications,
                    and improve our services.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    Data Storage
                  </h3>
                  <p className="mb-4">
                    Your data is stored securely using industry-standard
                    encryption. We never sell your personal information to third
                    parties.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    Your Rights
                  </h3>
                  <p className="mb-4">
                    You have the right to access, correct, or delete your
                    personal data at any time. You can export your data or
                    request account deletion from the Settings page.
                  </p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">
                    Contact Us
                  </h3>
                  <p className="mb-4">
                    If you have questions about this Privacy Policy, please
                    contact us at privacy@noor.financial.
                  </p>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100">
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="w-full py-3 bg-black text-white rounded-xl font-medium"
                >
                  {t("common.close")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100">
        <div className="max-w-md mx-auto px-6 py-5">
          {/* Submit Error */}
          {submitError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
            >
              <p className="text-red-600 text-sm text-center">{submitError}</p>
            </motion.div>
          )}
          <button
            onClick={handleSubmit}
            // First layer of the consent gate, and the only place required
            // fields get checked now that this is a single screen. The read
            // markers (termsViewed / privacyViewed) are deliberately absent
            // from this condition.
            disabled={
              isSubmitting ||
              !data.agreeToTerms ||
              !data.firstName ||
              !data.monthlyIncome ||
              !data.monthlyExpenses ||
              (!isAuthed &&
                (!data.email ||
                  !passwordValidation.isValid ||
                  !passwordsMatch))
            }
            className="w-full py-3.5 bg-black text-white rounded-xl font-medium transition-all duration-300 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {t("survey.submit.creating")}
              </span>
            ) : (
              t("survey.submit.complete")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
