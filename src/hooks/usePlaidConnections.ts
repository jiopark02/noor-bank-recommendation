import { useState, useCallback, useEffect } from "react";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import { getSupabaseBearerHeaders } from "@/lib/supabase-browser";
import { asPlainObject, readErrorMessage, readString } from "@/lib/requestJson";

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
  const [error, setError] = useState<string | null>(null);

  // Fetch existing connections from the DB (authoritative source), not
  // localStorage — so connection state survives a localStorage purge
  // (logout / shared-device cleanup / a new device).
  const fetchConnections = useCallback(async () => {
    if (!userId) {
      setConnections([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/plaid/connections", {
        method: "GET",
        headers: await getSupabaseBearerHeaders(),
      });

      const payload = asPlainObject(await response.json());
      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload) || "Failed to load bank connections"
        );
      }

      const list = Array.isArray(payload.connections)
        ? (payload.connections as PlaidConnection[])
        : [];
      setConnections(list);
    } catch (err) {
      // Distinguish a transient load failure from "no connections": set an
      // error and DO NOT collapse to an empty/disconnected state, so callers
      // don't surface the connect card (which would push the user to re-link and
      // create duplicate connection rows) on a temporary hiccup.
      console.error("Error fetching connections:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load bank connections"
      );
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Load connections on mount
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Connect a new bank (open Plaid Link)
  const connect = useCallback(async () => {
    if (!userId) {
      setError("Please log in first");
      return;
    }

    try {
      // Request link token from backend
      const plaidHeaders = buildJsonAuthorizedHeaders(
        await getSupabaseBearerHeaders()
      );
      const response = await fetch("/api/plaid/create-link-token", {
        method: "POST",
        headers: plaidHeaders,
        body: JSON.stringify({}),
      });

      const payload = asPlainObject(await response.json());
      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload) || "Failed to create link token"
        );
      }

      const linkToken = readString(payload, "linkToken");
      if (!linkToken) {
        throw new Error("Failed to create link token");
      }
      return linkToken;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect bank";
      setError(message);
      throw err;
    }
  }, [userId]);

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

  // Relink a broken connection
  const relink = useCallback(
    async (itemId: string) => {
      if (!userId) {
        setError("Please log in first");
        return;
      }

      try {
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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to relink bank";
        setError(message);
        throw err;
      }
    },
    [userId]
  );

  // Handle successful bank connection from Plaid Link
  const handleConnectionSuccess = useCallback(
    async (data: {
      itemId: string;
      accessToken?: string;
      institutionName: string;
      institutionId?: string;
    }) => {
      try {
        // Exchange public token for access token
        const plaidHeaders = buildJsonAuthorizedHeaders(
          await getSupabaseBearerHeaders()
        );
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: plaidHeaders,
          body: JSON.stringify({
            publicToken: data.accessToken, // In real flow, this would be exchanged client-side or server-side
            itemId: data.itemId,
            institutionName: data.institutionName,
            institutionId: data.institutionId,
          }),
        });

        const payload = asPlainObject(await response.json());
        if (!response.ok) {
          throw new Error(
            readErrorMessage(payload) || "Failed to save connection"
          );
        }

        // Re-pull authoritative state from the DB (no localStorage mutation).
        await fetchConnections();

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save connection";
        setError(message);
        return false;
      }
    },
    [userId, fetchConnections]
  );

  return {
    connections,
    isLoading,
    error,
    hasActive:
      connections.length > 0 && connections.some((c) => c.status === "active"),
    connect,
    disconnect,
    relink,
    handleConnectionSuccess,
    refetch: fetchConnections,
  };
}
