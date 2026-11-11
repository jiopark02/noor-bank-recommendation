"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PageLayout } from "@/components/layout";
import { ConnectBankCard, PlaidLinkButton } from "@/components/plaid";
import { CATEGORY_ICONS } from "@/lib/plaid";
import { usePlaidConnections } from "@/hooks/usePlaidConnections";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import { getSupabaseBearerHeaders, readSession } from "@/lib/supabase-browser";
import {
  PROTECTED_SESSION_RETRY,
  decideProtectedMount,
  retryUntilAnswered,
  shouldRetrySessionRead,
  waitMs,
} from "@/lib/sessionFlow";
import { clearLocalAuthState } from "@/lib/validation";
import {
  asPlainObject,
  readErrorMessage,
  readString,
} from "@/lib/requestJson";
import {
  bankActionLines,
  banksNotRead,
  browserTimeZone,
  creditUsedCents,
  decideBankView,
  describeBankAction,
  formatCents,
  formatCentsOrDash,
  formatMonthlyOrUnknown,
  formatSpending,
  incompletePeriodNote,
  isNoActiveConnectionMessage,
  missingBanksNote,
  parseFinanceSummaryResponse,
  parseTransactionsListResponse,
  summaryLoadInputs,
  summaryPeriodNote,
  utilizationPercent,
  type MoneyDisplayState,
  type ScreenSummaryResponse,
  type ScreenTransaction,
} from "@/lib/bankSummaryView";
import type {
  BankCompleteness,
  BankConnectionStatus,
} from "@/lib/plaidEngineAdapter";

type TabId = "overview" | "accounts" | "transactions" | "subscriptions";

const BANK_DATA_LOAD_FAILED =
  "We couldn't load your bank data right now. Please try again in a moment.";

// Only "ready" and "none" may render a dollar amount (decideBankView decides
// which applies). An unknown figure must not look like a real $0.
function MoneyFigure({
  state,
  children,
}: {
  state: MoneyDisplayState;
  children: React.ReactNode;
}) {
  if (state === "loading") {
    return (
      <>
        <span
          aria-hidden="true"
          className="inline-block w-24 h-[0.75em] rounded bg-gray-200 animate-pulse align-middle"
        />
        <span className="sr-only">Loading</span>
      </>
    );
  }
  if (state === "unavailable") {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Unavailable</span>
      </>
    );
  }
  return <>{children}</>;
}

export default function MoneyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionDelayed, setSessionDelayed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  // The summary route's answer for this load. Every amount and account on this
  // screen comes from it; the screen only formats.
  // Typed by the fields bankSummaryView checks, so a field read here that is
  // not checked there is a type error.
  const [bank, setBank] = useState<ScreenSummaryResponse | null>(null);
  // True only once the summary route has answered successfully in this load.
  const [hasMoneyData, setHasMoneyData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ScreenTransaction[]>([]);
  // The list's period as the list route reported it; null until it answers.
  const [transactionsCompleteness, setTransactionsCompleteness] =
    useState<BankCompleteness | null>(null);
  // The list route's own connection statuses: a bank it could not read is
  // missing from the list, which says so.
  const [transactionConnections, setTransactionConnections] = useState<
    BankConnectionStatus[]
  >([]);
  const [transactionsError, setTransactionsError] = useState<string | null>(
    null
  );
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [relinkItemId, setRelinkItemId] = useState<string | null>(null);
  const [relinkToken, setRelinkToken] = useState<string | null>(null);
  const [isPreparingRelink, setIsPreparingRelink] = useState(false);
  // The bank whose re-link request failed. Shown next to that bank only; it is
  // not a failed load, and the figures and other banks' lines stay.
  const [relinkFailedItemId, setRelinkFailedItemId] = useState<string | null>(
    null
  );
  // Connection management (accounts tab): inline-confirm remove + add-bank notice.
  const [confirmingRemoveItemId, setConfirmingRemoveItemId] = useState<
    string | null
  >(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [addBankNotice, setAddBankNotice] = useState<string | null>(null);
  // Same pattern as addBankNotice, for the other direction. A failed removal had
  // no channel to the user at all before this: the hook set its shared `error`,
  // which this page reads only as a boolean, so the bank silently stayed in the
  // list with no explanation.
  const [removeNotice, setRemoveNotice] = useState<string | null>(null);

  // Use the Plaid connections hook
  const plaidConnections = usePlaidConnections(userId);
  // Stable across renders (a callback keyed on userId inside the hook), unlike
  // the hook's return object, so loaders can depend on it without re-running
  // the fetch effect on every render.
  const refetchConnections = plaidConnections.refetch;

  // Initialize user. noor_user_id is only a legacy synchronous cache; the live
  // Supabase session is the source of truth. Verify it before rendering so an
  // ended session redirects cleanly to /login instead of showing the page
  // with every Plaid endpoint returning 401. Only a clean "none" means that: a
  // read that never answered can come from a valid session, so it is retried,
  // then shown as a delay, and it never clears anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storedUserId = localStorage.getItem("noor_user_id");
      if (!storedUserId) {
        router.push("/welcome");
        return;
      }
      const read = await retryUntilAnswered(
        (timeoutMs, attempt) => readSession(timeoutMs, "money-mount", attempt),
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
      setUserId(read.session.user.id);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // The figures, accounts and connection statuses. A failure here is shown as
  // a failed load (dashes), never as an empty one.
  const loadSummary = useCallback(
    async (headers: HeadersInit) => {
      try {
        const res = await fetch("/api/finance/summary", {
          method: "POST",
          headers,
          body: JSON.stringify({ timeZone: browserTimeZone() }),
        });

        if (!res.ok) {
          const data = asPlainObject(await res.json().catch(() => ({})));
          const errText = readString(data, "error") ?? null;
          if (isNoActiveConnectionMessage(errText)) {
            // Re-pull authoritative connection state from the DB, which is the
            // only place connection state lives.
            refetchConnections();
          }
          throw new Error(readErrorMessage(data) || BANK_DATA_LOAD_FAILED);
        }

        const parsed = parseFinanceSummaryResponse(
          await res.json().catch(() => null)
        );
        if (parsed === null) {
          throw new Error(BANK_DATA_LOAD_FAILED);
        }
        setBank(parsed);
        setHasMoneyData(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : BANK_DATA_LOAD_FAILED);
      }
    },
    [refetchConnections]
  );

  // The transaction list. Its failure affects the list only, not the figures.
  const loadTransactions = useCallback(async (headers: HeadersInit) => {
    try {
      const res = await fetch("/api/plaid/transactions", {
        method: "POST",
        headers,
        body: JSON.stringify({ timeZone: browserTimeZone() }),
      });

      if (!res.ok) {
        const data = asPlainObject(await res.json().catch(() => ({})));
        throw new Error(readErrorMessage(data) || "Failed to fetch transactions");
      }

      const parsed = parseTransactionsListResponse(
        await res.json().catch(() => null)
      );
      if (parsed === null) {
        throw new Error(BANK_DATA_LOAD_FAILED);
      }
      setTransactions(parsed.transactions);
      setTransactionConnections(parsed.connections);
      setTransactionsCompleteness(parsed.period.completeness);
    } catch (err) {
      setTransactionsError(
        err instanceof Error ? err.message : "Failed to fetch transactions"
      );
    }
  }, []);

  // Fetch the summary and the transaction list, independently.
  const fetchData = useCallback(async () => {
    if (!userId || !plaidConnections.hasActive) {
      setBank(null);
      setTransactions([]);
      setTransactionConnections([]);
      setTransactionsCompleteness(null);
      return;
    }

    // Drop the previous answer first, so nothing from an earlier load is drawn
    // while this one runs or after it fails.
    setHasMoneyData(false);
    setError(null);
    setBank(null);
    setTransactions([]);
    setTransactionConnections([]);
    setTransactionsCompleteness(null);
    setTransactionsError(null);
    setRelinkFailedItemId(null);
    setIsLoadingData(true);

    try {
      const plaidHeaders = buildJsonAuthorizedHeaders(
        await getSupabaseBearerHeaders()
      );
      await Promise.all([
        loadSummary(plaidHeaders),
        loadTransactions(plaidHeaders),
      ]);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err instanceof Error ? err.message : BANK_DATA_LOAD_FAILED);
    } finally {
      setIsLoadingData(false);
    }
  }, [userId, plaidConnections.hasActive, loadSummary, loadTransactions]);

  // Fetch data when the user connects a bank
  useEffect(() => {
    if (userId && plaidConnections.hasActive) {
      fetchData();
    }
  }, [userId, plaidConnections.hasActive, fetchData]);

  // Handle new bank connection
  const handleBankConnected = useCallback(() => {
    setRelinkItemId(null);
    setRelinkToken(null);
    setError(null);
    plaidConnections.refetch();
  }, [plaidConnections]);

  // Re-link one bank: the item id comes from the connection the summary
  // reported as needing a new login, never from a position in a list. A failed
  // request is recorded against that bank only.
  const handleRelink = useCallback(
    async (itemId: string) => {
      try {
        setRelinkItemId(itemId);
        setRelinkToken(null);
        setRelinkFailedItemId(null);
        setIsPreparingRelink(true);
        setRelinkToken(await plaidConnections.relink(itemId));
      } catch (err) {
        console.error("Relink failed:", err);
        setRelinkFailedItemId(itemId);
      } finally {
        setIsPreparingRelink(false);
      }
    },
    [plaidConnections]
  );

  // Update mode repairs the existing Item's login in place: its access token
  // does not change, so there is nothing to exchange and nothing to store. The
  // public token Link hands back here is deliberately not sent anywhere.
  //
  // fetchData() is called explicitly because a re-link leaves hasActive
  // unchanged, so the hasActive-dependent fetch effect would not re-run.
  const handleRelinkSuccess = useCallback(async () => {
    setRelinkToken(null);
    handleBankConnected();
    await fetchData();
  }, [handleBankConnected, fetchData]);

  // Remove a single connection. The route now revokes the Plaid Item first and
  // deletes the row only if that succeeded, so a failure means the bank is still
  // connected — the list will still show it after the refetch, and the notice
  // below is what explains why.
  //
  // The hook re-fetches connections on success; we ALSO call fetchData()
  // explicitly because removing one of several banks leaves hasActive unchanged,
  // so the hasActive-dependent fetch effect would not re-run on its own.
  const handleRemoveConnection = useCallback(
    async (itemId: string) => {
      setRemovingItemId(itemId);
      setRemoveNotice(null);
      try {
        const result = await plaidConnections.disconnect(itemId);
        if (result.ok) {
          await fetchData();
        } else {
          // The server's wording, rendered as-is. It has already picked between
          // "try again" and "this one is on us"; do not re-derive that here.
          setRemoveNotice(result.message);
        }
      } finally {
        setRemovingItemId(null);
        setConfirmingRemoveItemId(null);
      }
    },
    [plaidConnections, fetchData]
  );

  // Add another bank, from the compact button in the connection list (not
  // ConnectBankCard, the full empty-state card). POST exchange-token, surface
  // the 409 ALREADY_CONNECTED duplicate case and any other refusal as an inline
  // notice, and also reload this screen's data on success. ConnectBankCard
  // reads the response the same way and shows its own notice.
  const handleAddBankSuccess = useCallback(
    async (
      publicToken: string,
      metadata: { institution: { name: string; institution_id: string } }
    ) => {
      if (!userId) return;
      setAddBankNotice(null);
      try {
        const plaidHeaders = buildJsonAuthorizedHeaders(
          await getSupabaseBearerHeaders()
        );
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: plaidHeaders,
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution.institution_id,
            institutionName: metadata.institution.name,
          }),
        });

        const data = asPlainObject(await response.json());

        if (
          response.status === 409 ||
          readString(data, "code") === "ALREADY_CONNECTED"
        ) {
          const name =
            readString(data, "institutionName") ||
            metadata.institution.name ||
            "This bank";
          setAddBankNotice(`${name} is already connected.`);
          return;
        }

        if (data.success !== true) {
          throw new Error(readErrorMessage(data) || "Failed to add bank");
        }

        handleBankConnected();
        await fetchData();
      } catch (err) {
        setAddBankNotice(
          err instanceof Error ? err.message : "Failed to add bank"
        );
      }
    },
    [userId, handleBankConnected, fetchData]
  );

  // Only prompt to connect once we've actually determined there is no
  // connection. While the connection check is loading, or if it failed with a
  // transient error, suppress the card — otherwise a temporary hiccup would push
  // the user to re-link and create duplicate connection rows.
  const shouldShowConnectCard =
    !!userId &&
    !plaidConnections.isLoading &&
    !plaidConnections.error &&
    (!plaidConnections.hasActive || isNoActiveConnectionMessage(error));

  const view = decideBankView({
    ...summaryLoadInputs({
      connectionsLoading: plaidConnections.isLoading,
      connectionsFailed: !!plaidConnections.error,
      hasActiveConnection: plaidConnections.hasActive,
      loadError: error,
      hasData: hasMoneyData,
    }),
    response: bank,
  });
  const moneyDisplay: MoneyDisplayState = view.figures;
  const summary = view.figures === "ready" && bank ? bank.summary : null;
  const accounts = summary && bank ? bank.accounts : [];
  const missingNote = missingBanksNote(view.missingFrom);
  const periodNote = summaryPeriodNote(view, bank);
  const transactionsMissingNote = missingBanksNote(
    banksNotRead(transactionConnections)
  );
  const transactionsPeriodNote = incompletePeriodNote(transactionsCompleteness);
  const loadFailedMessage =
    moneyDisplay === "unavailable" && !isNoActiveConnectionMessage(error)
      ? error ?? "We couldn't read any of your banks just now."
      : null;

  // Engine figures as they arrived. With no connection the zeros are true.
  const figures = {
    cash: summary ? summary.safeToSpend.totals.spendableCashCents : 0,
    creditUsed: summary ? creditUsedCents(summary) : 0,
    income: summary ? summary.cashFlow.incomeCents : 0,
    spending: summary ? summary.cashFlow.spendingNetCents : 0,
    recurringMonthly: summary ? summary.recurring.totalMonthlyCents : 0,
    recurringItems: summary ? summary.recurring.items : [],
  };

  // Reloads rather than reading again: a client whose auth read has hung stays
  // hung until the page recreates it.
  if (sessionDelayed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-xl font-semibold text-black mb-2">
            We couldn&apos;t confirm your sign-in
          </h1>
          <p className="text-gray-500 mb-6">
            Please check your connection and try again.
          </p>
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div
          className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "accounts", label: "Accounts" },
    { id: "transactions", label: "Transactions" },
    { id: "subscriptions", label: "Subscriptions" },
  ];

  return (
    <PageLayout>
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black">Money</h1>
            <p className="text-gray-500 text-sm">
              All your finances in one place
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoadingData && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          Syncing your latest bank data...
        </div>
      )}

      {loadFailedMessage && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{loadFailedMessage}</p>
        </div>
      )}

      {view.actions.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
          {bankActionLines(view.actions, relinkFailedItemId).map(
            ({ action, relinkError }) => (
            <div key={action.itemId}>
              <p className="text-sm text-amber-900">
                {describeBankAction(action)}
              </p>
              {relinkError && (
                <p className="mt-1 text-xs text-red-700">{relinkError}</p>
              )}
              {action.kind === "relink" &&
                !(relinkToken && relinkItemId === action.itemId) && (
                  <button
                    onClick={() => handleRelink(action.itemId)}
                    disabled={isPreparingRelink}
                    className="mt-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPreparingRelink && relinkItemId === action.itemId
                      ? "Preparing re-link..."
                      : `Re-link ${action.institutionName}`}
                  </button>
                )}
              {action.kind === "relink" &&
                relinkToken &&
                relinkItemId === action.itemId &&
                userId && (
                  <div className="mt-2">
                    <PlaidLinkButton
                      userId={userId}
                      linkTokenOverride={relinkToken}
                      onSuccess={handleRelinkSuccess}
                      className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white"
                    >
                      Complete bank re-link
                    </PlaidLinkButton>
                  </div>
                )}
              {action.kind === "retry" && (
                <button
                  type="button"
                  onClick={() => fetchData()}
                  className="mt-2 rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900"
                >
                  Try again
                </button>
              )}
            </div>
            )
          )}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Balances */}
            <div className="noor-card p-6 mb-4">
              {missingNote && (
                <p className="text-xs text-amber-800 mb-3">{missingNote}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-600 text-xs">Spendable cash</p>
                  <p className="text-2xl font-semibold text-green-700">
                    <MoneyFigure state={moneyDisplay}>
                      {formatCents(figures.cash)}
                    </MoneyFigure>
                  </p>
                </div>
                <div>
                  <p className="text-gray-600 text-xs">Credit card balances</p>
                  <p className="text-2xl font-semibold text-red-700">
                    <MoneyFigure state={moneyDisplay}>
                      {formatCentsOrDash(figures.creditUsed)}
                    </MoneyFigure>
                  </p>
                </div>
              </div>
            </div>

            {/* Last 90 days */}
            <p className="text-gray-500 text-xs mb-2">Last 90 days</p>
            {periodNote && (
              <p className="text-xs text-amber-800 mb-2">{periodNote}</p>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Income</p>
                <p className="text-xl font-semibold text-green-600">
                  <MoneyFigure state={moneyDisplay}>
                    +{formatCents(figures.income)}
                  </MoneyFigure>
                </p>
              </div>
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Spending</p>
                <p className="text-xl font-semibold text-red-600">
                  <MoneyFigure state={moneyDisplay}>
                    {formatSpending(figures.spending)}
                  </MoneyFigure>
                </p>
              </div>
            </div>

            {/* Subscriptions Summary */}
            <div className="noor-card p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-black">
                  Monthly Subscriptions
                </h3>
                <span className="text-lg font-semibold text-black">
                  <MoneyFigure state={moneyDisplay}>
                    {formatMonthlyOrUnknown(figures.recurringMonthly)}
                  </MoneyFigure>
                </span>
              </div>
              {moneyDisplay === "ready" && (
                <div className="flex flex-wrap gap-2">
                  {figures.recurringItems.map((item) => (
                    <span
                      key={item.streamId}
                      className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                    >
                      {item.label} · {formatCents(item.monthlyCents)}/mo
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Connect Bank Account */}
            {shouldShowConnectCard && (
              <ConnectBankCard
                userId={userId}
                onConnected={handleBankConnected}
              />
            )}
          </motion.div>
        )}

        {/* Accounts Tab */}
        {activeTab === "accounts" && (
          <motion.div
            key="accounts"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Linked banks: connection list + remove + add another */}
            {plaidConnections.connections.length > 0 && (
              <div className="noor-card p-5 mb-4">
                <h3 className="font-medium text-black mb-3">Linked banks</h3>
                <div className="space-y-1">
                  {plaidConnections.connections.map((conn) => (
                    <div
                      key={conn.itemId}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-black truncate">
                          {conn.institutionName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {conn.status === "active"
                            ? "Connected"
                            : "Needs attention"}
                        </p>
                      </div>
                      {confirmingRemoveItemId === conn.itemId ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleRemoveConnection(conn.itemId)}
                            disabled={removingItemId === conn.itemId}
                            className="text-xs font-medium text-red-600 px-2 py-1 rounded disabled:opacity-50"
                          >
                            {removingItemId === conn.itemId
                              ? "Removing…"
                              : "Confirm"}
                          </button>
                          <button
                            onClick={() => setConfirmingRemoveItemId(null)}
                            disabled={removingItemId === conn.itemId}
                            className="text-xs text-gray-500 px-2 py-1 rounded disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            setConfirmingRemoveItemId(conn.itemId)
                          }
                          className="text-xs font-medium text-gray-600 hover:text-red-600 px-2.5 py-1 rounded border border-gray-200 flex-shrink-0"
                        >
                          Remove permanently
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {removeNotice && (
                  <p className="text-xs text-gray-600 mt-2">{removeNotice}</p>
                )}

                {userId && (
                  <div className="mt-4">
                    {/* Keyed on the count so the button remounts and asks for
                        a fresh link token when a bank is added or removed:
                        otherwise a limit refusal fetched at the limit stays on
                        screen after a removal frees a slot. */}
                    <PlaidLinkButton
                      key={plaidConnections.connections.length}
                      userId={userId}
                      onSuccess={handleAddBankSuccess}
                      className="w-full py-3 border border-gray-300 text-black font-medium rounded-xl disabled:opacity-50 transition-all"
                    >
                      + Add another bank
                    </PlaidLinkButton>
                    {addBankNotice && (
                      <p className="text-xs text-gray-600 mt-2">
                        {addBankNotice}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {missingNote && (
              <p className="text-xs text-amber-800 mb-3">{missingNote}</p>
            )}

            <div className="space-y-3">
              {accounts.map((account) => {
                const isCredit = account.type === "credit";
                const percent =
                  isCredit && summary
                    ? utilizationPercent(summary, account.accountId)
                    : null;
                return (
                  <motion.div
                    key={account.accountId}
                    className="noor-card p-5"
                    whileHover={{ scale: 1.01 }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-black">{account.name}</p>
                        <p className="text-sm text-gray-500">
                          {account.institutionName ?? "Your bank"}
                          {account.mask ? ` · ****${account.mask}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xl font-semibold ${
                            isCredit ? "text-red-600" : "text-black"
                          }`}
                        >
                          {formatCentsOrDash(account.currentCents)}
                        </p>
                        {isCredit && (
                          <p className="text-xs text-gray-500">balance owed</p>
                        )}
                        {isCredit && account.limitCents !== null && (
                          <p className="text-xs text-gray-500">
                            of {formatCents(account.limitCents)} limit
                          </p>
                        )}
                        {!isCredit && account.availableCents !== null && (
                          <p className="text-xs text-gray-500">
                            {formatCents(account.availableCents)} available
                          </p>
                        )}
                      </div>
                    </div>
                    {percent !== null && (
                      <div className="mt-3">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              percent > 70 ? "bg-red-500" : "bg-green-500"
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {percent}% used
                        </p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {shouldShowConnectCard && (
              <div className="mt-6">
                <ConnectBankCard
                  userId={userId}
                  onConnected={handleBankConnected}
                />
              </div>
            )}
          </motion.div>
        )}

        {/* Transactions Tab */}
        {activeTab === "transactions" && (
          <motion.div
            key="transactions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {transactionsError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-700">{transactionsError}</p>
              </div>
            )}
            {transactionsMissingNote && (
              <p className="text-xs text-amber-800 mb-3">
                {transactionsMissingNote}
              </p>
            )}
            {transactionsPeriodNote && (
              <p className="text-xs text-amber-800 mb-3">
                {transactionsPeriodNote}
              </p>
            )}
            <div className="space-y-2">
              {transactions.map((txn) => (
                <motion.div
                  key={`${txn.accountId}:${txn.transactionId}`}
                  className="noor-card px-4 py-3 flex items-center justify-between"
                  whileHover={{ scale: 1.01 }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">
                      {CATEGORY_ICONS[txn.category[0]] || "💰"}
                    </span>
                    <div>
                      <p className="font-medium text-black text-sm">
                        {txn.merchantName || txn.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(txn.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        {txn.pending && " · Pending"}
                      </p>
                    </div>
                  </div>
                  <p
                    className={`font-semibold ${
                      txn.amountCents < 0 ? "text-green-600" : "text-black"
                    }`}
                  >
                    {formatSpending(txn.amountCents)}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Subscriptions Tab */}
        {activeTab === "subscriptions" && (
          <motion.div
            key="subscriptions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Total */}
            <div className="noor-card p-5 mb-4 bg-gradient-to-r from-purple-500 to-pink-500 text-black">
              <p className="text-black/80 text-sm mb-1">
                Monthly Subscriptions
              </p>
              <p className="text-3xl font-semibold">
                <MoneyFigure state={moneyDisplay}>
                  {formatMonthlyOrUnknown(figures.recurringMonthly)}
                  {figures.recurringMonthly !== null && "/mo"}
                </MoneyFigure>
              </p>
            </div>

            {/* Subscription List */}
            <div className="space-y-2">
              {moneyDisplay !== "ready" ? null : figures.recurringMonthly ===
                null ? (
                <div className="noor-card p-8 text-center">
                  <p className="text-gray-500">
                    We couldn&apos;t read your recurring charges yet
                  </p>
                  <p className="text-gray-400 text-sm mt-1">
                    Recurring charges show up once your bank has enough history
                  </p>
                </div>
              ) : figures.recurringItems.length > 0 ? (
                figures.recurringItems.map((item, i) => (
                  <motion.div
                    key={item.streamId}
                    className="noor-card p-4 flex items-center justify-between"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                        <span className="text-lg">📱</span>
                      </div>
                      <div>
                        <p className="font-medium text-black">{item.label}</p>
                        {item.nextDate && (
                          <p className="text-xs text-gray-500">
                            Next expected{" "}
                            {new Date(
                              item.nextDate + "T00:00:00Z"
                            ).toLocaleDateString("en-US", { timeZone: "UTC" })}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="font-semibold text-black">
                      {formatCents(item.monthlyCents)}/mo
                    </p>
                  </motion.div>
                ))
              ) : (
                <div className="noor-card p-8 text-center">
                  <p className="text-gray-500">No recurring charges detected</p>
                </div>
              )}
            </div>

            {/* Tips */}
            <div className="noor-card p-4 mt-4 bg-blue-50">
              <p className="text-sm text-blue-800">
                💡 Tip: Cancel unused subscriptions to save money. Even
                $10/month is $120/year!
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageLayout>
  );
}
