import { useState, useCallback, useEffect } from "react";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import { getSupabaseBearerHeaders } from "@/lib/supabase-browser";
import { asPlainObject, readErrorMessage, readString } from "@/lib/requestJson";
import { clearPlaidLocalState } from "@/lib/validation";
import { createRequestGate } from "@/lib/bankSummaryView";
import {
  BANK_SCREEN_FETCH_TIMEOUT_MS,
  withFetchTimeout,
} from "@/lib/screenFetchTimeout";

export interface PlaidConnection {
  itemId: string;
  institutionName: string;
  institutionId?: string;
  status: "active" | "error";
  createdAt?: string;
}

/**
 * What `disconnect` reports back.
 *
 * `message` carries the SERVER's wording verbatim when there is one. The
 * disconnect route now answers two different kinds of failure with two
 * different messages — one that asks the user to retry, one that says the fault
 * is ours and deliberately does not — and the caller must not try to reconstruct
 * that distinction from a status or a `code`. Render the string.
 */
export interface DisconnectResult {
  ok: boolean;
  message: string | null;
}

/** Used only when the server sent no message at all (or the fetch failed). */
const DISCONNECT_FALLBACK_MESSAGE =
  "We couldn't disconnect this bank. Please try again in a moment. " +
  "If this keeps happening, please contact support.";

export function usePlaidConnections(userId: string | null) {
  const [connections, setConnections] = useState<PlaidConnection[]>([]);
  // Starts true so consumers don't flash a "not connected" state (and prompt a
  // re-link) before the first fetch resolves.
  const [isLoading, setIsLoading] = useState(true);
  // Set only by fetchConnections: non-null means the connection list could
  // not be read. A failed disconnect or re-link is reported to its caller.
  const [error, setError] = useState<string | null>(null);

  // Only the latest list read writes state. Each read now ends at the latest
  // when the screen's limit runs out, so without this an earlier read that
  // timed out could mark the list failed after a later read had loaded it.
  const [requestGate] = useState(createRequestGate);

  // Fetch existing connections from the DB (authoritative source), not
  // localStorage — so connection state survives a localStorage purge
  // (logout / shared-device cleanup / a new device).
  const fetchConnections = useCallback(async () => {
    const token = requestGate.begin();
    if (!userId) {
      setConnections([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers = await getSupabaseBearerHeaders();
      // The request and its body read run under the screen's limit, so a
      // list that never answers ends in the error state, not on loading.
      const { ok, payload } = await withFetchTimeout(
        BANK_SCREEN_FETCH_TIMEOUT_MS,
        async (signal) => {
          const response = await fetch("/api/plaid/connections", {
            method: "GET",
            headers,
            signal,
          });
          return {
            ok: response.ok,
            payload: asPlainObject(await response.json()),
          };
        }
      );
      if (!ok) {
        throw new Error(
          readErrorMessage(payload) || "Failed to load bank connections"
        );
      }

      const list = Array.isArray(payload.connections)
        ? (payload.connections as PlaidConnection[])
        : [];
      if (!requestGate.isCurrent(token)) return;
      setConnections(list);
    } catch (err) {
      if (!requestGate.isCurrent(token)) return;
      // Distinguish a transient load failure from "no connections": set an
      // error and DO NOT collapse to an empty/disconnected state, so callers
      // don't surface the connect card (which would push the user to re-link and
      // create duplicate connection rows) on a temporary hiccup.
      console.error("Error fetching connections:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load bank connections"
      );
    } finally {
      if (requestGate.isCurrent(token)) setIsLoading(false);
    }
  }, [userId, requestGate]);

  // Load connections on mount
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Disconnect a bank.
  //
  // A failure here is REPORTED TO THE CALLER, never written into this hook's
  // shared `error`. That field means "loading the connection list failed", and
  // money/page.tsx reads it as a boolean to decide whether to suppress the
  // connect-a-bank card. Putting a disconnect failure in it would conflate two
  // unrelated conditions in a value that is only ever read for its truthiness —
  // and it would still not be displayed anywhere, which is how a failed
  // disconnect used to reach the user as silence.
  const disconnect = useCallback(
    async (itemId: string): Promise<DisconnectResult> => {
      if (!userId) {
        return { ok: false, message: "Please log in first" };
      }

      try {
        const plaidHeaders = buildJsonAuthorizedHeaders(
          await getSupabaseBearerHeaders()
        );
        const response = await fetch("/api/plaid/disconnect", {
          method: "POST",
          headers: plaidHeaders,
          body: JSON.stringify({ itemId }),
        });

        const payload = asPlainObject(await response.json());
        if (!response.ok) {
          // The server's own wording, unmodified. It has already chosen between
          // "try again" and "this is our fault"; the `code` it also sends is for
          // logs and support, not for the caller to branch on.
          return {
            ok: false,
            message: readErrorMessage(payload) || DISCONNECT_FALLBACK_MESSAGE,
          };
        }

        // Only past the !ok early return, so this runs on a CONFIRMED deletion
        // and never in the catch or a finally: if the POST failed the row still
        // exists and the connection is still live, and clearing local state
        // would present a failed operation as a partial success.
        //
        // The app no longer writes the Plaid keys; this removes whatever an
        // earlier build left. Before the refetch, so a slow or failing reload
        // does not delay it.
        clearPlaidLocalState();

        // Re-pull authoritative state from the DB instead of mutating a local
        // cache (localStorage is no longer the source of truth). The row is gone
        // only when the Plaid Item was actually revoked, so this refetch is what
        // shows the user whether the removal really happened.
        await fetchConnections();

        return { ok: true, message: null };
      } catch (err) {
        // A transport failure, or a response with no JSON body (an unhandled
        // 500 answers with neither `error` nor `code`).
        console.error("Error disconnecting bank:", err);
        return { ok: false, message: DISCONNECT_FALLBACK_MESSAGE };
      }
    },
    [userId, fetchConnections]
  );

  // Ask for a link token to repair one connection's login.
  //
  // A failure is THROWN TO THE CALLER, never written into the shared `error`,
  // for the same reason as disconnect: `error` means "loading the connection
  // list failed", and the money screen reads it to mark every figure as
  // unknown. A failed re-link request concerns one bank, and the caller shows
  // it next to that bank.
  const relink = useCallback(
    async (itemId: string): Promise<string> => {
      if (!userId) {
        throw new Error("Please log in first");
      }

      const plaidHeaders = buildJsonAuthorizedHeaders(
        await getSupabaseBearerHeaders()
      );
      const response = await fetch("/api/plaid/relink", {
        method: "POST",
        headers: plaidHeaders,
        body: JSON.stringify({ itemId }),
      });

      const payload = asPlainObject(await response.json());
      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload) || "Failed to create relink token"
        );
      }

      const linkToken = readString(payload, "linkToken");
      if (!linkToken) {
        throw new Error("Failed to create relink token");
      }
      return linkToken;
    },
    [userId]
  );

  return {
    connections,
    isLoading,
    error,
    hasActive:
      connections.length > 0 && connections.some((c) => c.status === "active"),
    disconnect,
    relink,
    refetch: fetchConnections,
  };
}
