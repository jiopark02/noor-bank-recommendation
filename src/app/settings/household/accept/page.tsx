"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/layout";
import { readSession } from "@/lib/supabase-browser";
import {
  PROTECTED_SESSION_RETRY,
  decideProtectedMount,
  retryUntilAnswered,
  shouldRetrySessionRead,
  waitMs,
} from "@/lib/sessionFlow";
import { clearLocalAuthState } from "@/lib/validation";
import { HOUSEHOLD_MESSAGES, HOUSEHOLD_UI } from "@/lib/householdCopy";
import {
  acceptOutcomeUnknown,
  acceptUnknownAfterPreview,
  afterAccept,
  afterLeave,
  afterPreview,
  browserHouseholdHttp,
  householdCall,
  invitedSentence,
  readInviteFragment,
  type AcceptStep,
  type AcceptView,
} from "@/lib/householdClient";

/**
 * /settings/household/accept#household_invite=<token> — joins the household
 * an invite names. The token is moved from the fragment into memory and the
 * fragment is removed at once; it is sent only as the body of the preview
 * request and of the accept request, and accepting happens only on the
 * button press. When the person must first leave a household with someone
 * else in it, leaving here returns to the join step with the same token.
 * When an accept ends without a definite answer, the retry's preview reads a
 * missing invite as "could not confirm whether you joined", not as an
 * invalid link.
 */

/** Removes the fragment (and the token in it) from the address bar. */
function removeFragment(): void {
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search
  );
}

const BUTTON = "w-full py-3 rounded-xl text-[14px] font-medium";

export default function HouseholdAcceptPage() {
  const router = useRouter();
  const tokenRef = useRef<string | null>(null);
  // An accept on this screen ended without telling whether it took effect
  // (acceptOutcomeUnknown). Kept beside the token, read by the next preview
  // (afterPreview) and updated after it (acceptUnknownAfterPreview).
  const acceptUnknownRef = useRef(false);
  const mountedRef = useRef(false);
  const [view, setView] = useState<AcceptView>({ kind: "checking" });
  const [sessionDelayed, setSessionDelayed] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const apply = (step: AcceptStep) => {
    if (!step.keepToken) tokenRef.current = null;
    setView(step.view);
  };

  useEffect(() => {
    let cancelled = false;
    // The token taken on an earlier run of this effect wins over the URL:
    // that run removed the fragment. React Strict Mode runs the effect twice
    // in development, and refs survive between the two runs.
    if (tokenRef.current === null) {
      tokenRef.current = readInviteFragment(window.location.href);
    }
    if (window.location.hash !== "") removeFragment();

    (async () => {
      const read = await retryUntilAnswered(
        (timeoutMs, attempt) => readSession(timeoutMs, "household-accept", attempt),
        shouldRetrySessionRead,
        PROTECTED_SESSION_RETRY,
        { sleep: waitMs, isCancelled: () => cancelled }
      );
      if (cancelled) return;
      const action = decideProtectedMount(read);
      if (action === "sign-out") {
        clearLocalAuthState();
        router.replace("/login");
        return;
      }
      if (action === "show-delayed" || read.status !== "session") {
        setSessionDelayed(true);
        return;
      }
      const token = tokenRef.current;
      if (token === null) {
        setView({ kind: "no-link" });
        return;
      }
      const outcome = await householdCall(
        read,
        browserHouseholdHttp,
        "/api/household/invite/preview",
        "POST",
        { token }
      );
      if (cancelled) return;
      apply(afterPreview(outcome));
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleRetry = async () => {
    const token = tokenRef.current;
    if (token === null) {
      setView({ kind: "no-link" });
      return;
    }
    setView({ kind: "checking" });
    const read = await readSession(undefined, "household-accept");
    const outcome = await householdCall(
      read,
      browserHouseholdHttp,
      "/api/household/invite/preview",
      "POST",
      { token }
    );
    if (!mountedRef.current) return;
    const acceptUnknown = acceptUnknownRef.current;
    acceptUnknownRef.current = acceptUnknownAfterPreview(outcome, acceptUnknown);
    apply(afterPreview(outcome, acceptUnknown));
  };

  // Runs only from the join button.
  const handleJoin = async (inviterFirstName: string | null) => {
    const token = tokenRef.current;
    if (token === null) {
      setView({ kind: "no-link" });
      return;
    }
    setView({ kind: "joining", inviterFirstName });
    const read = await readSession(undefined, "household-accept");
    const outcome = await householdCall(
      read,
      browserHouseholdHttp,
      "/api/household/invite/accept",
      "POST",
      { token }
    );
    if (!mountedRef.current) return;
    acceptUnknownRef.current = acceptOutcomeUnknown(outcome);
    apply(afterAccept(outcome, inviterFirstName));
  };

  // Runs only from the leave button. Success returns to the join step with
  // the token still held; failure shows its sentence and keeps the token.
  const handleLeaveCurrent = async (inviterFirstName: string | null) => {
    setView({ kind: "leaving", inviterFirstName });
    const read = await readSession(undefined, "household-accept");
    const outcome = await householdCall(
      read,
      browserHouseholdHttp,
      "/api/household/leave",
      "POST"
    );
    if (!mountedRef.current) return;
    acceptUnknownRef.current = false;
    apply(afterLeave(outcome, inviterFirstName));
  };

  // Reloads rather than reading again: a client whose auth read has hung stays
  // hung until the page recreates it. The token is gone after a reload, so
  // the link has to be opened again.
  if (sessionDelayed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-sm w-full text-center">
          <p className="text-gray-500 mb-6">{HOUSEHOLD_UI.sessionUnconfirmed}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${BUTTON} bg-black text-white`}
          >
            {HOUSEHOLD_UI.reload}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28 bg-white">
      <div className="max-w-sm mx-auto px-6 pt-16">
        <h1 className="text-xl font-semibold text-black mb-6">{HOUSEHOLD_UI.acceptTitle}</h1>

        {view.kind === "checking" && <p className="text-gray-500">{HOUSEHOLD_UI.checking}</p>}

        {view.kind === "no-link" && <p className="text-gray-700">{HOUSEHOLD_UI.openLinkAgain}</p>}

        {(view.kind === "ready" || view.kind === "joining") && (
          <div>
            {view.kind === "ready" && view.notice && (
              <p className="text-[13px] text-white bg-black rounded-xl px-4 py-3 mb-4">{view.notice}</p>
            )}
            <p className="text-gray-800 mb-2">{invitedSentence(view.inviterFirstName)}</p>
            <p className="text-gray-500 text-[13px] mb-6">{HOUSEHOLD_UI.joinMoves}</p>
            <button
              type="button"
              onClick={() => handleJoin(view.inviterFirstName)}
              disabled={view.kind === "joining"}
              className={`${BUTTON} bg-black text-white disabled:opacity-40`}
            >
              {view.kind === "joining" ? HOUSEHOLD_UI.joining : HOUSEHOLD_UI.joinButton}
            </button>
            <button
              type="button"
              onClick={() => router.push("/settings/household")}
              disabled={view.kind === "joining"}
              className={`${BUTTON} mt-3 bg-gray-100 text-black disabled:opacity-40`}
            >
              {HOUSEHOLD_UI.notNow}
            </button>
          </div>
        )}

        {(view.kind === "must-leave" || view.kind === "leaving") && (
          <div>
            <p className="text-gray-800 mb-4">{HOUSEHOLD_MESSAGES.MUST_LEAVE_FIRST}</p>
            {view.kind === "must-leave" && view.error && (
              <p className="text-[13px] text-red-600 mb-4">{view.error}</p>
            )}
            <button
              type="button"
              onClick={() => handleLeaveCurrent(view.inviterFirstName)}
              disabled={view.kind === "leaving"}
              className={`${BUTTON} bg-black text-white disabled:opacity-40`}
            >
              {view.kind === "leaving" ? HOUSEHOLD_UI.leavingCurrent : HOUSEHOLD_UI.leaveCurrentButton}
            </button>
          </div>
        )}

        {view.kind === "joined" && (
          <div>
            <p className="text-gray-800 mb-6">{HOUSEHOLD_UI.joined}</p>
            <button
              type="button"
              onClick={() => router.push("/settings/household")}
              className={`${BUTTON} bg-black text-white`}
            >
              {HOUSEHOLD_UI.goToHousehold}
            </button>
          </div>
        )}

        {view.kind === "join-unconfirmed" && (
          <div>
            <p className="text-gray-800 mb-6">{HOUSEHOLD_UI.joinUnconfirmed}</p>
            <button
              type="button"
              onClick={() => router.push("/settings/household")}
              className={`${BUTTON} bg-black text-white`}
            >
              {HOUSEHOLD_UI.goToHousehold}
            </button>
          </div>
        )}

        {view.kind === "failed" && (
          <div>
            <p className="text-gray-800 mb-6">{view.message}</p>
            {view.retry && (
              <button type="button" onClick={handleRetry} className={`${BUTTON} bg-black text-white`}>
                {HOUSEHOLD_UI.tryAgain}
              </button>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
