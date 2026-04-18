"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getSupabaseBearerHeaders } from "@/lib/supabaseAuthHeaders";
import {
  usePlaidLink,
  PlaidLinkOptions,
  PlaidLinkOnSuccess,
} from "react-plaid-link";
import { motion } from "framer-motion";

interface PlaidLinkButtonProps {
  userId: string;
  onSuccess: (
    publicToken: string,
    metadata: { institution: { name: string; institution_id: string } }
  ) => void;
  onExit?: () => void;
  className?: string;
  children?: React.ReactNode;
  linkTokenOverride?: string;
}

export function PlaidLinkButton({
  userId,
  onSuccess,
  onExit,
  className,
  children,
  linkTokenOverride,
}: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch link token on mount
  useEffect(() => {
    if (linkTokenOverride) {
      setLinkToken(linkTokenOverride);
      setError(null);
      return;
    }

    const fetchLinkToken = async () => {
      try {
        setIsLoading(true);
        const authHeaders = await getSupabaseBearerHeaders();
        const response = await fetch("/api/plaid/create-link-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({}),
        });

        const data = await response.json();

        if (data.success) {
          setLinkToken(data.linkToken);
        } else {
          setError(data.error || "Failed to create link token");
        }
      } catch (err) {
        setError("Failed to initialize Plaid");
        console.error("Error fetching link token:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (userId) {
      fetchLinkToken();
    }
  }, [userId, linkTokenOverride]);

  const handleSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken, metadata) => {
      onSuccess(publicToken, {
        institution: {
          name: metadata.institution?.name || "Unknown Bank",
          institution_id: metadata.institution?.institution_id || "",
        },
      });
    },
    [onSuccess]
  );

  const config: PlaidLinkOptions = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: () => {
      onExit?.();
    },
  };

  const { open, ready } = usePlaidLink(config);

  if (error) {
    return (
      <div className="text-center p-4">
        <p className="text-red-500 text-sm">{error}</p>
        <p className="text-gray-400 text-xs mt-2">
          Plaid needs to be configured. Add your API keys to environment
          variables.
        </p>
      </div>
    );
  }

  return (
    <motion.button
      onClick={() => open()}
      disabled={!ready || isLoading}
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
  );
}

// Connect card component - Functional version
interface ConnectBankCardProps {
  userId: string;
  onConnected?: () => void;
}

export function ConnectBankCard({ userId, onConnected }: ConnectBankCardProps) {
  const handleSuccess = useCallback(
    async (
      publicToken: string,
      metadata: { institution: { name: string; institution_id: string } }
    ) => {
      try {
        // Exchange public token for access token
        const authHeaders = await getSupabaseBearerHeaders();
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution.institution_id,
            institutionName: metadata.institution.name,
          }),
        });

        const data = await response.json();

        if (data.success) {
          const stored = localStorage.getItem("noor_plaid_connections") || "[]";
          const existing = JSON.parse(stored) as Array<{
            itemId: string;
            institutionName: string;
            institutionId?: string;
            status: "active" | "error";
            createdAt?: string;
          }>;

          const nextConnection = {
            itemId: data.itemId,
            institutionName:
              data.institutionName ||
              metadata.institution.name ||
              "Unknown Bank",
            institutionId:
              data.institutionId ||
              metadata.institution.institution_id ||
              undefined,
            status: "active" as const,
            createdAt: new Date().toISOString(),
          };

          const deduped = existing.filter(
            (c) => c.itemId !== nextConnection.itemId
          );
          deduped.push(nextConnection);
          localStorage.setItem(
            "noor_plaid_connections",
            JSON.stringify(deduped)
          );

          // Refresh parent component
          onConnected?.();
        } else {
          console.error("Failed to exchange token:", data.error);
        }
      } catch (err) {
        console.error("Error exchanging token:", err);
      }
    },
    [userId, onConnected]
  );

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
        onSuccess={handleSuccess}
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
    </motion.div>
  );
}
