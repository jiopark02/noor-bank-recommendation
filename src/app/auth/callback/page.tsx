"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, readSession } from "@/lib/supabase-browser";
import {
  CALLBACK_SESSION_RETRY,
  CALLBACK_SURVEY_RETRY,
  CALLBACK_SYNC_TIMEOUT_MS,
  PROFILE_READ_TIMEOUT_MS,
  decideCallbackRoute,
  decideCallbackSession,
  readSurveyLookup,
  retryUntilAnswered,
  settleWithin,
  shouldRetrySessionRead,
  surveyLookupLogDetail,
  waitMs,
} from "@/lib/sessionFlow";
import { getSurveyFieldsForUserProfile } from "@/lib/surveyResponseProfile";
import { createSession } from "@/lib/validation";
import { namesFromSyncResponse } from "@/lib/syncProfileNames";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Something we could not find out, as opposed to `error`, which is an answer.
  // The user stays here with a retry and is not sent to /login.
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    const handleCallback = async () => {
      if (!supabase) {
        setError("Authentication service unavailable");
        return;
      }
      const client = supabase;

      try {
        // supabase-js exchanges the OAuth code while the client initializes,
        // and a session read waits for that. A failed exchange is not an error
        // here: the library swallows it and the read answers "none".
        const read = await retryUntilAnswered(
          (timeoutMs, attempt) =>
            readSession(timeoutMs, "auth-callback", attempt),
          shouldRetrySessionRead,
          CALLBACK_SESSION_RETRY,
          { sleep: waitMs, isCancelled }
        );
        if (cancelled) return;

        const action = decideCallbackSession(read);
        if (action === "show-retry") {
          setRetryMessage(
            "We couldn't reach the sign-in service. Please check your connection and try again."
          );
          return;
        }
        if (action === "no-session" || read.status !== "session") {
          setError("No session found. Please try again.");
          return;
        }

        // Save user info to localStorage
        const session = read.session;
        const user = session.user;
        const fullName =
          user.user_metadata?.full_name || user.user_metadata?.name || "";
        const firstNameFromFull = fullName ? fullName.split(" ")[0] : "";
        const lastNameFromFull = fullName
          ? fullName.split(" ").slice(1).join(" ")
          : "";
        let profile: Record<string, unknown> = {
          id: user.id,
          email: user.email,
          firstName: user.user_metadata?.first_name || firstNameFromFull,
          lastName: user.user_metadata?.last_name || lastNameFromFull,
          avatar:
            user.user_metadata?.avatar_url ||
            user.user_metadata?.picture ||
            "",
        };

        const surveyFields = await settleWithin(
          getSurveyFieldsForUserProfile(client, user.id),
          PROFILE_READ_TIMEOUT_MS
        );
        if (cancelled) return;
        profile = {
          ...profile,
          ...(surveyFields.timedOut ? {} : surveyFields.value),
        };

        // New vs returning is decided by the DB, not a local cache: does a
        // survey_responses row exist for this user? (The old
        // noor_onboarding_completed check read a key nothing wrote while the
        // check existed, so every OAuth login was treated as new. Writers for
        // the key were added on 2026-07-06, in the change that replaced the
        // check, and have since been removed; no code ever read what they
        // wrote.)
        let lookupFailure = "";
        const lookup = await retryUntilAnswered(
          async (timeoutMs) => {
            const outcome = await settleWithin(
              client
                .from("survey_responses")
                .select("id")
                .eq("user_id", user.id)
                .limit(1)
                .maybeSingle(),
              timeoutMs
            );
            lookupFailure = surveyLookupLogDetail(outcome);
            return readSurveyLookup(outcome);
          },
          (result) => result === "failed",
          CALLBACK_SURVEY_RETRY,
          { sleep: waitMs, isCancelled }
        );
        if (cancelled) return;

        // Not knowing is not the same as being new: a returning user must not
        // land on the survey because this read failed. Stopping before the
        // sync loses nothing, since the retry reloads and runs it, and the
        // upsert behind it can be repeated.
        if (lookup === "failed") {
          console.error("Survey lookup failed:", lookupFailure);
          setRetryMessage(
            "We couldn't load your account details. Please try again."
          );
          return;
        }

        // Sync the profile row to public.users. We MUST check res.ok: a silent
        // failure leaves the user without a users row, which breaks
        // recommendations and — via the survey_responses FK — blocks survey
        // completion.
        let syncOk = false;
        const syncAbort = new AbortController();
        const syncTimer = setTimeout(
          () => syncAbort.abort(),
          CALLBACK_SYNC_TIMEOUT_MS
        );
        try {
          const syncRes = await fetch("/api/auth/sync-profile", {
            method: "POST",
            signal: syncAbort.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            // The server takes email and metadata from the verified token,
            // so only the id and display names are sent.
            body: JSON.stringify({
              id: user.id,
              first_name: profile.firstName,
              last_name: profile.lastName,
            }),
          });
          syncOk = syncRes.ok;
          if (syncOk) {
            // Store the names the server wrote, with its placeholder first
            // name as empty, so the local profile follows the database.
            // Without them, the names computed above are kept.
            const syncedNames = namesFromSyncResponse(
              await syncRes.json().catch(() => null)
            );
            if (syncedNames) {
              profile = { ...profile, ...syncedNames };
            }
          } else {
            console.error(
              "Profile sync failed:",
              syncRes.status,
              await syncRes.text().catch(() => "")
            );
          }
        } catch (syncError) {
          console.error("Profile sync failed:", syncError);
        } finally {
          clearTimeout(syncTimer);
        }
        if (cancelled) return;

        // Surface the failure only when it actually blocks the user: a NEW
        // user needs the users row before they can complete the survey (FK),
        // so stop and let them retry via re-login rather than dropping them
        // into a broken state. A RETURNING user already has their row, so a
        // non-critical sync refresh failure must not lock them out.
        const route = decideCallbackRoute(lookup, syncOk);
        if (route === "setup-error") {
          setError(
            "We couldn't finish setting up your account. Please try signing in again."
          );
          return;
        }

        localStorage.setItem("noor_user_id", user.id);
        localStorage.setItem("noor_user_profile", JSON.stringify(profile));

        // Create session (keep signed in by default for OAuth)
        createSession(true);

        if (route === "survey") {
          // No survey yet — send them to complete their profile.
          router.push("/survey");
        } else {
          router.push("/dashboard");
        }
      } catch (err) {
        console.error("Callback error:", err);
        setError("Authentication failed. Please try again.");
      }
    };

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Reloads rather than reading again: a hung code exchange never settles in
  // this client, and a reload starts it over. After a finished exchange the
  // code is gone from the URL, so a reload simply finds the session.
  if (retryMessage) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-xl font-semibold text-black mb-2">
            We couldn&apos;t finish signing you in
          </h1>
          <p className="text-gray-500 mb-6">{retryMessage}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-12 h-12 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-600"
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
          </div>
          <h1 className="text-xl font-semibold text-black mb-2">
            Authentication Failed
          </h1>
          <p className="text-gray-500 mb-6">{error}</p>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="w-12 h-12 mx-auto mb-6">
          <svg
            className="animate-spin w-12 h-12 text-black"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-black mb-2">
          Signing you in...
        </h1>
        <p className="text-gray-500">
          Please wait while we complete your authentication.
        </p>
      </div>
    </div>
  );
}
