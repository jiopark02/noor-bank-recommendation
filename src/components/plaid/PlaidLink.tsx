"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import { readSession } from "@/lib/supabase-browser";
import { waitMs } from "@/lib/sessionFlow";
import {
  linkTokenRefusalMessage,
  linkTokenSession,
  readPlaidSession,
} from "@/lib/plaidConnectFlow";
import { linkExitedWithError } from "@/lib/plaidRelinkFlow";
import { asPlainObject, readErrorMessage, readString } from "@/lib/requestJson";
import {
  BANK_SCREEN_FETCH_TIMEOUT_MS,
  withFetchTimeout,
} from "@/lib/screenFetchTimeout";
import {
  usePlaidLink,
  PlaidLinkOptions,
  PlaidLinkOnSuccess,
} from "react-plaid-link";
import { motion } from "framer-motion";
import {
  createLinkSession,
  IDLE_LINK_SESSION,
  LINK_START_FAILED_MESSAGE,
  LINK_TOKEN_FALLBACK_MESSAGE,
  LinkSessionState,
  LinkTokenResult,
} from "./linkSession";
import { PlaidExchangeStatus } from "./PlaidExchangeStatus";
import type { PlaidExchangeView } from "./usePlaidExchange";

type LinkInstitutionMetadata = {
  institution: { name: string; institution_id: string };
};

/**
 * Asks the server for a link token for a new connection. Never throws: every
 * failure, a time-out included, comes back as a sentence to show.
 */
async function requestNewLinkToken(): Promise<LinkTokenResult> {
  try {
    // The session is read until it answers, and the request is made only with
    // its access token: without one nothing is sent, so the route never sees
    // this request without an Authorization header. The read sits outside the
    // limit below, which is for the server's answer.
    const session = linkTokenSession(
      await readPlaidSession({
        readSession: (timeoutMs, attempt) =>
          readSession(timeoutMs, "plaid-connect", attempt),
        sleep: waitMs,
      })
    );
    if (!session.ok) {
      return { ok: false, message: session.message };
    }
    const plaidHeaders = buildJsonAuthorizedHeaders({
      Authorization: `Bearer ${session.accessToken}`,
    });
    // The request and its body read run under the bank screens' limit, so a
    // request that never answers ends as a failed attempt, not a button that
    // stays busy.
    const { status, data } = await withFetchTimeout(
      BANK_SCREEN_FETCH_TIMEOUT_MS,
      async (signal) => {
        const response = await fetch("/api/plaid/create-link-token", {
          method: "POST",
          headers: plaidHeaders,
          body: JSON.stringify({}),
          signal,
        });
        return {
          status: response.status,
          data: asPlainObject(await response.json()),
        };
      }
    );

    if (data.success === true) {
      const token = readString(data, "linkToken");
      if (token) return { ok: true, token };
    }
    return {
      ok: false,
      // A refusal over the sign-in gets a sentence of ours, not the route's
      // "Unauthorized"; every other refusal keeps the route's wording.
      message:
        linkTokenRefusalMessage(status, data) ||
        readErrorMessage(data) ||
        LINK_TOKEN_FALLBACK_MESSAGE,
    };
  } catch (err) {
    console.error("Error fetching link token:", err);
    return { ok: false, message: LINK_START_FAILED_MESSAGE };
  }
}

interface LinkSessionRunnerProps {
  token: string;
  onSuccess: PlaidLinkOnSuccess;
  /** Told only whether Link closed reporting an error. */
  onExit: (exitedWithError: boolean) => void;
  onStartFailed: () => void;
}

/**
 * Opens Link once with one token. The button mounts a new one per token (it is
 * keyed on the token): usePlaidLink keeps its previous handler in state after
 * that handler is destroyed, so reusing one instance across tokens can report
 * `ready` with an `open` that does nothing.
 *
 * Link's exit callback is given an error (null when the user closed Link) and
 * details of the session. Only whether there was an error leaves this
 * component; the details are not received at all.
 */
function LinkSessionRunner({
  token,
  onSuccess,
  onExit,
  onStartFailed,
}: LinkSessionRunnerProps) {
  const opened = useRef(false);
  const config: PlaidLinkOptions = {
    token,
    onSuccess,
    onExit: (exitError) => {
      onExit(linkExitedWithError(exitError));
    },
  };
  const { open, ready, error } = usePlaidLink(config);

  useEffect(() => {
    if (error) {
      onStartFailed();
      return;
    }
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, error, open, onStartFailed]);

  return null;
}

interface PlaidLinkButtonProps {
  userId: string;
  onSuccess: (publicToken: string, metadata: LinkInstitutionMetadata) => void;
  /**
   * Link closed without succeeding. The argument says only whether Link
   * reported an error; false is the user closing it.
   */
  onExit?: (exitedWithError: boolean) => void;
  className?: string;
  children?: React.ReactNode;
  linkTokenOverride?: string;
  /** Drawn disabled, whatever the session's phase (an exchange is running). */
  disabled?: boolean;
}

export function PlaidLinkButton({
  userId,
  onSuccess,
  onExit,
  className,
  children,
  linkTokenOverride,
  disabled = false,
}: PlaidLinkButtonProps) {
  const [sessionState, setSessionState] =
    useState<LinkSessionState>(IDLE_LINK_SESSION);
  // Read at press time, so a re-link token handed in after mount is the one used.
  const overrideRef = useRef<string | null>(linkTokenOverride ?? null);
  overrideRef.current = linkTokenOverride ?? null;

  const [session] = useState(() =>
    createLinkSession({
      requestToken: requestNewLinkToken,
      overrideToken: () => overrideRef.current,
      onChange: setSessionState,
    })
  );

  // Nothing is requested here: the token is asked for on a press only. The
  // effect attaches the session and its cleanup detaches it, so answers that
  // arrive while the button is gone are dropped. Attaching in the body (not
  // only creating the session once) is what lets the session work again when
  // React runs the cleanup and then the effect on the same button.
  useEffect(() => {
    session.attach();
    return () => session.dispose();
  }, [session]);

  const handleSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken, metadata) => {
      session.finished();
      onSuccess(publicToken, {
        institution: {
          name: metadata.institution?.name || "Unknown Bank",
          institution_id: metadata.institution?.institution_id || "",
        },
      });
    },
    [session, onSuccess]
  );

  const handleExit = useCallback(
    (exitedWithError: boolean) => {
      session.finished();
      onExit?.(exitedWithError);
    },
    [session, onExit]
  );

  const handleStartFailed = useCallback(() => {
    session.failed(LINK_START_FAILED_MESSAGE);
  }, [session]);

  const { phase, token, error } = sessionState;
  const isLoading = phase === "requesting";

  return (
    <>
      <motion.button
        onClick={() => session.click()}
        disabled={disabled || !userId || phase !== "idle"}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={
          className ||
          "w-full py-4 bg-black text-white font-medium rounded-xl disabled:opacity-50 transition-all"
        }
      >
          {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
                className="opacity-25"
              />
              <path
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                fill="currentColor"
                className="opacity-75"
              />
            </svg>
            Loading...
          </span>
        ) : (
          children || "Connect Bank Account"
        )}
      </motion.button>

      {/* The button stays, so a failed attempt can be retried by pressing
          it again. */}
      {error && (
        <p className="text-red-500 text-sm text-center mt-2" role="alert">
          {error}
        </p>
      )}

      {phase === "open" && token && (
        <LinkSessionRunner
          key={token}
          token={token}
          onSuccess={handleSuccess}
          onExit={handleExit}
          onStartFailed={handleStartFailed}
        />
      )}
    </>
  );
}

// Connect card component - Functional version
interface ConnectBankCardProps {
  userId: string;
  /**
   * The screen's exchange (usePlaidExchange). It is owned by the screen and
   * not by this card: the card is unmounted while the connection list reloads
   * and on a tab change, and a public token held here would be lost with it.
   */
  exchange: PlaidExchangeView;
}

export function ConnectBankCard({ userId, exchange }: ConnectBankCardProps) {
  return (
    <motion.div
      className="noor-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        </div>
        <h3 className="font-semibold text-lg text-black mb-2">
          Automatic Bank Connection
        </h3>
        <p className="text-gray-500 text-sm">
          Connect your bank accounts to see all your finances in one place.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <svg
            className="w-5 h-5 text-green-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>View all balances in one place</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <svg
            className="w-5 h-5 text-green-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>Track spending automatically</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <svg
            className="w-5 h-5 text-green-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>Find hidden subscriptions</span>
        </div>
      </div>

      <PlaidLinkButton
        userId={userId}
        onSuccess={exchange.onLinkSuccess}
        disabled={exchange.phase === "exchanging"}
        className="w-full py-4 bg-black text-white font-medium rounded-xl hover:bg-gray-900 transition-all"
      >
        <span className="flex items-center justify-center gap-2">
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
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          Connect Bank Account
        </span>
      </PlaidLinkButton>

      {/* Every outcome of the exchange is said here: a refusal used to reach
          only the console, so the card looked as if nothing happened. The
          failure colour is for the sentence it ended with; the progress line
          keeps the status block's own plain colour. */}
      <PlaidExchangeStatus
        exchange={exchange}
        textClassName="text-sm text-red-500 text-center mt-3"
      />
    </motion.div>
  );
}
