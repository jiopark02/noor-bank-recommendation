import { useState, useCallback, useEffect } from "react";
import { getSupabaseBearerHeaders } from "@/lib/supabaseAuthHeaders";

export interface PlaidConnection {
  itemId: string;
  institutionName: string;
  institutionId?: string;
  status: "active" | "error";
  createdAt?: string;
}

export function usePlaidConnections(userId: string | null) {
  const [connections, setConnections] = useState<PlaidConnection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing connections
  const fetchConnections = useCallback(async () => {
    if (!userId) {
      setConnections([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // For now, we store connections in localStorage for the frontend
      // In a production app with proper session auth, you'd call the backend
      const stored = localStorage.getItem("noor_plaid_connections");
      if (stored) {
        setConnections(JSON.parse(stored));
      } else {
        setConnections([]);
      }
    } catch (err) {
      console.error("Error fetching connections:", err);
      setError("Failed to load bank connections");
      setConnections([]);
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
      const authHeaders = await getSupabaseBearerHeaders();
      const response = await fetch("/api/plaid/create-link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create link token");
      }

      const { linkToken } = await response.json();
      return linkToken; // Return link token so component can open Plaid Link
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect bank";
      setError(message);
      throw err;
    }
  }, [userId]);

  // Disconnect a bank
  const disconnect = useCallback(
    async (itemId: string) => {
      if (!userId) {
        setError("Please log in first");
        return false;
      }

      try {
        const authHeaders = await getSupabaseBearerHeaders();
        const response = await fetch("/api/plaid/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ itemId }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to disconnect");
        }

        // Update local state
        setConnections((prev) => prev.filter((c) => c.itemId !== itemId));

        // Update localStorage
        const stored = localStorage.getItem("noor_plaid_connections");
        if (stored) {
          const all = JSON.parse(stored).filter(
            (c: PlaidConnection) => c.itemId !== itemId
          );
          localStorage.setItem("noor_plaid_connections", JSON.stringify(all));
        }

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to disconnect";
        setError(message);
        return false;
      }
    },
    [userId]
  );

  // Relink a broken connection
  const relink = useCallback(
    async (itemId: string) => {
      if (!userId) {
        setError("Please log in first");
        return;
      }

      try {
        const authHeaders = await getSupabaseBearerHeaders();
        const response = await fetch("/api/plaid/relink", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ itemId }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to create relink token");
        }

        const { linkToken } = await response.json();
        return linkToken; // Return link token so component can open Plaid Link
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
        const authHeaders = await getSupabaseBearerHeaders();
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            publicToken: data.accessToken, // In real flow, this would be exchanged client-side or server-side
            itemId: data.itemId,
            institutionName: data.institutionName,
            institutionId: data.institutionId,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to save connection");
        }

        // Update local connections
        const newConnection: PlaidConnection = {
          itemId: data.itemId,
          institutionName: data.institutionName,
          institutionId: data.institutionId,
          status: "active",
          createdAt: new Date().toISOString(),
        };

        setConnections((prev) => [...prev, newConnection]);

        // Save to localStorage
        const stored = localStorage.getItem("noor_plaid_connections") || "[]";
        const all = JSON.parse(stored);
        all.push(newConnection);
        localStorage.setItem("noor_plaid_connections", JSON.stringify(all));

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save connection";
        setError(message);
        return false;
      }
    },
    [userId]
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
