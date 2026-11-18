"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import { readSession } from "@/lib/supabase-browser";
import { waitMs } from "@/lib/sessionFlow";
import { asPlainObject } from "@/lib/requestJson";
import {
  BANK_SCREEN_FETCH_TIMEOUT_MS,
  withFetchTimeout,
} from "@/lib/screenFetchTimeout";
import {
  activeItemIds,
  createPublicTokenHolder,
  readConnectionList,
  type ConnectionSummary,
  type ExchangeDeps,
  type LinkInstitution,
} from "@/lib/plaidConnectFlow";

export type PlaidExchangePhase = "idle" | "exchanging" | "notice";

export type PlaidExchangeView = {
  phase: PlaidExchangePhase;
  /** The sentence to show; null unless the phase is "notice". */
  notice: string | null;
  /** The token is still held, so "Try again" sends it again. */
  canRetry: boolean;
  /** Plaid Link's success handler for a new connection. */
  onLinkSuccess: (
    publicToken: string,
    metadata: { institution: LinkInstitution }
  ) => void;
  retry: () => void;
};

type Options = {
  /** The signed-in user the screen knows, or null. */
  userId: string | null;
  /**
   * The connection list the screen is showing now. Its active Item ids are
   * recorded when Link hands over a token: a connection counts as made by
   * that token only when its Item id was not among them.
   */
  knownConnections: ReadonlyArray<ConnectionSummary>;
  onConnected: () => void;
};

type ScreenState = {
  phase: PlaidExchangePhase;
  notice: string | null;
  canRetry: boolean;
};

const IDLE: ScreenState = { phase: "idle", notice: null, canRetry: false };

/**
 * The real requests behind plaidConnectFlow's decisions. The exchange request
 * has no time limit on purpose: the Item already exists at Plaid, and giving
 * up on the request does not stop the server finishing it. The list read runs
 * under the bank screens' limit, like every other read of that list.
 */
const liveDeps: ExchangeDeps = {
  readSession: (timeoutMs, attempt) => readSession(timeoutMs, "plaid-connect", attempt),
  sleep: waitMs,
  now: () => Date.now(),

  async post(accessToken, payload) {
    const response = await fetch("/api/plaid/exchange-token", {
      method: "POST",
      headers: buildJsonAuthorizedHeaders({ Authorization: `Bearer ${accessToken}` }),
      body: JSON.stringify(payload),
    });
    // A body that does not arrive or is not JSON is reported, not decided
    // here: plaidConnectFlow reads the status with that fact.
    try {
      const parsed: unknown = await response.json();
      return { status: response.status, body: asPlainObject(parsed), bodyRead: true };
    } catch {
      return { status: response.status, body: {}, bodyRead: false };
    }
  },

  async readConnections(accessToken) {
    return withFetchTimeout(BANK_SCREEN_FETCH_TIMEOUT_MS, async (signal) => {
      const response = await fetch("/api/plaid/connections", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      const body: unknown = await response.json();
      // Which fields of a row are read is plaidConnectFlow's, not this file's.
      return response.ok ? readConnectionList(body) : null;
    });
  },
};

/**
 * Exchanges the public token Plaid Link hands over, and keeps it while the
 * exchange can still be tried again.
 *
 * Call it once, in the screen, not in a component that comes and goes: the
 * token lives in this hook's memory only, so it is lost when the component
 * that called the hook unmounts. Nothing here writes it anywhere else.
 */
export function usePlaidExchange({
  userId,
  knownConnections,
  onConnected,
}: Options): PlaidExchangeView {
  const [state, setState] = useState<ScreenState>(IDLE);
  const [holder] = useState(() => createPublicTokenHolder(liveDeps));

  // Read when Link succeeds or an attempt ends, so the values are the
  // screen's latest and the callbacks below keep one identity.
  const latest = useRef({ userId, knownConnections, onConnected });
  latest.current = { userId, knownConnections, onConnected };

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!holder.hasToken()) return;
    setState({ phase: "exchanging", notice: null, canRetry: false });
    const outcome = await holder.send();
    if (!mounted.current || outcome.kind === "superseded") return;
    if (outcome.kind === "notice") {
      setState({
        phase: "notice",
        notice: outcome.message,
        canRetry: outcome.canRetry,
      });
      return;
    }
    setState(IDLE);
    if (outcome.kind === "connected") latest.current.onConnected();
  }, [holder]);

  const onLinkSuccess = useCallback(
    (publicToken: string, metadata: { institution: LinkInstitution }) => {
      holder.hold(
        publicToken,
        metadata.institution,
        latest.current.userId,
        activeItemIds(latest.current.knownConnections)
      );
      void run();
    },
    [holder, run]
  );

  const retry = useCallback(() => {
    if (!holder.hasToken()) {
      // Nothing left to send: the button that led here is stale.
      setState(IDLE);
      return;
    }
    void run();
  }, [holder, run]);

  return {
    phase: state.phase,
    notice: state.notice,
    canRetry: state.canRetry,
    onLinkSuccess,
    retry,
  };
}
