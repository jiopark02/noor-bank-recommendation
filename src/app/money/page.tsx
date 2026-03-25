"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PageLayout } from "@/components/layout";
import { ConnectBankCard, PlaidLinkButton } from "@/components/plaid";
import {
  PlaidAccount,
  PlaidTransaction,
  formatCurrency,
  CATEGORY_ICONS,
  CATEGORY_COLORS,
} from "@/lib/plaid";
import { usePlaidConnections } from "@/hooks/usePlaidConnections";

type TabId = "overview" | "accounts" | "transactions" | "subscriptions";

type SubscriptionView = {
  id: string;
  name: string;
  amount: number;
  monthly_amount: number;
  frequency: "weekly" | "monthly" | "yearly" | "unknown";
  last_charged: string | null;
  next_charge: string | null;
  source: "plaid_recurring" | "heuristic";
};

export default function MoneyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<PlaidTransaction[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relinkItemId, setRelinkItemId] = useState<string | null>(null);
  const [relinkToken, setRelinkToken] = useState<string | null>(null);
  const [isPreparingRelink, setIsPreparingRelink] = useState(false);

  // Date range for transactions
  const [startDate, setStartDate] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );

  // Use the Plaid connections hook
  const plaidConnections = usePlaidConnections(userId);

  // Initialize user
  useEffect(() => {
    const storedUserId = localStorage.getItem("noor_user_id");
    if (!storedUserId) {
      router.push("/welcome");
      return;
    }
    setUserId(storedUserId);
    setIsLoading(false);
  }, [router]);

  // Fetch accounts and transactions
  const fetchData = useCallback(async () => {
    if (!userId || !plaidConnections.hasActive) {
      setAccounts([]);
      setTransactions([]);
      setSubscriptions([]);
      return;
    }

    setIsLoadingData(true);
    setError(null);

    try {
      // Fetch accounts
      const accountsRes = await fetch("/api/plaid/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!accountsRes.ok) {
        const data = await accountsRes.json();
        if (data.errorType === "ITEM_LOGIN_REQUIRED") {
          setError(
            "Your bank connection has expired. Please re-link your account."
          );
          setRelinkItemId(plaidConnections.connections[0]?.itemId || null);
          return;
        }
        throw new Error(data.error || "Failed to fetch accounts");
      }

      const accountsData = await accountsRes.json();
      if (accountsData.success) {
        setAccounts(accountsData.accounts);
      }

      // Fetch transactions
      const txnRes = await fetch("/api/plaid/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, startDate, endDate }),
      });

      if (!txnRes.ok) {
        const data = await txnRes.json();
        if (data.errorType === "ITEM_LOGIN_REQUIRED") {
          setError(
            "Your bank connection has expired. Please re-link your account."
          );
          setRelinkItemId(plaidConnections.connections[0]?.itemId || null);
          return;
        }
        throw new Error(data.error || "Failed to fetch transactions");
      }

      const txnData = await txnRes.json();
      if (txnData.success) {
        setTransactions(txnData.transactions);
        setSubscriptions(
          Array.isArray(txnData.subscriptions) ? txnData.subscriptions : []
        );
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      const message =
        err instanceof Error ? err.message : "Failed to fetch data";
      setError(message);
    } finally {
      setIsLoadingData(false);
    }
  }, [
    userId,
    plaidConnections.hasActive,
    plaidConnections.connections,
    startDate,
    endDate,
  ]);

  // Fetch data when user connects or date range changes
  useEffect(() => {
    if (userId && plaidConnections.hasActive) {
      fetchData();
    }
  }, [userId, plaidConnections.hasActive, startDate, endDate, fetchData]);

  // Handle date range change
  const handleDateRangeChange = (type: "start" | "end", value: string) => {
    if (type === "start") {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
  };

  // Handle new bank connection
  const handleBankConnected = useCallback(() => {
    setRelinkItemId(null);
    setRelinkToken(null);
    setError(null);
    plaidConnections.refetch();
  }, [plaidConnections]);

  // Handle re-link
  const handleRelink = useCallback(async () => {
    if (!relinkItemId) return;
    try {
      setIsPreparingRelink(true);
      const linkToken = await plaidConnections.relink(relinkItemId);
      if (linkToken) {
        setRelinkToken(linkToken);
      }
    } catch (err) {
      console.error("Relink failed:", err);
    } finally {
      setIsPreparingRelink(false);
    }
  }, [relinkItemId, plaidConnections]);

  const handleRelinkSuccess = useCallback(
    async (
      publicToken: string,
      metadata: { institution: { name: string; institution_id: string } }
    ) => {
      if (!userId) return;

      try {
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            publicToken,
            institutionId: metadata.institution.institution_id,
            institutionName: metadata.institution.name,
          }),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to complete re-link");
        }

        setRelinkToken(null);
        handleBankConnected();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to complete re-link";
        setError(message);
      }
    },
    [handleBankConnected, userId]
  );

  // Calculate totals
  const totals = useMemo(() => {
    const checking = accounts
      .filter((a) => a.type === "checking" || a.type === "savings")
      .reduce((sum, a) => sum + a.current_balance, 0);

    const credit = accounts
      .filter((a) => a.type === "credit")
      .reduce((sum, a) => sum + a.current_balance, 0);

    const creditLimit = accounts
      .filter((a) => a.type === "credit")
      .reduce((sum, a) => sum + (a.credit_limit || 0), 0);

    const netWorth = checking - credit;

    return { checking, credit, creditLimit, netWorth };
  }, [accounts]);

  // Calculate spending by category
  const categorySpending = useMemo(() => {
    const categories: Record<string, number> = {};

    transactions
      .filter((t) => t.amount > 0)
      .forEach((t) => {
        const category = t.category[0] || "Other";
        categories[category] = (categories[category] || 0) + t.amount;
      });

    return Object.entries(categories)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const totalSubscriptions = subscriptions.reduce(
    (sum, s) => sum + s.monthly_amount,
    0
  );

  // Monthly spending
  const monthlySpending = useMemo(() => {
    return transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  // Monthly income
  const monthlyIncome = useMemo(() => {
    return transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

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

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          {relinkItemId && !relinkToken && (
            <button
              onClick={handleRelink}
              disabled={isPreparingRelink}
              className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPreparingRelink ? "Preparing re-link..." : "Re-link bank"}
            </button>
          )}
          {relinkToken && userId && (
            <div className="mt-3">
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
            {/* Net Worth Card */}
            <div className="noor-card p-6 mb-4 bg-gradient-to-br from-gray-900 to-black text-black">
              <p className="text-gray-600 text-sm mb-1">Net Worth</p>
              <p className="text-4xl font-semibold mb-4">
                {formatCurrency(totals.netWorth)}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-600 text-xs">Cash</p>
                  <p className="text-lg font-medium text-green-700">
                    {formatCurrency(totals.checking)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600 text-xs">Credit Used</p>
                  <p className="text-lg font-medium text-red-700">
                    -{formatCurrency(totals.credit)}
                  </p>
                </div>
              </div>
            </div>

            {/* Monthly Summary */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Income</p>
                <p className="text-xl font-semibold text-green-600">
                  +{formatCurrency(monthlyIncome)}
                </p>
              </div>
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Spending</p>
                <p className="text-xl font-semibold text-red-600">
                  -{formatCurrency(monthlySpending)}
                </p>
              </div>
            </div>

            {/* Spending by Category */}
            <div className="noor-card p-5 mb-4">
              <h3 className="font-medium text-black mb-4">
                Spending by Category
              </h3>
              <div className="space-y-3">
                {categorySpending.slice(0, 5).map((cat) => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <span className="text-xl w-8">
                      {CATEGORY_ICONS[cat.name] || "💰"}
                    </span>
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm text-black">{cat.name}</span>
                        <span className="text-sm font-medium text-black">
                          {formatCurrency(cat.amount)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORY_COLORS[cat.name] || "#6B7280",
                          }}
                          initial={{ width: 0 }}
                          animate={{
                            width: `${(cat.amount / monthlySpending) * 100}%`,
                          }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Subscriptions Summary */}
            <div className="noor-card p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-black">
                  Monthly Subscriptions
                </h3>
                <span className="text-lg font-semibold text-black">
                  {formatCurrency(totalSubscriptions)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {subscriptions.map((sub, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                  >
                    {sub.name} · {formatCurrency(sub.monthly_amount)}/mo
                  </span>
                ))}
              </div>
            </div>

            {/* Connect Bank Account */}
            {!plaidConnections.hasActive && userId && (
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
            <div className="space-y-3">
              {accounts.map((account) => (
                <motion.div
                  key={account.id}
                  className="noor-card p-5"
                  whileHover={{ scale: 1.01 }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-black">{account.name}</p>
                      <p className="text-sm text-gray-500">
                        {account.institution_name} · ****{account.mask}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-xl font-semibold ${
                          account.type === "credit"
                            ? "text-red-600"
                            : "text-black"
                        }`}
                      >
                        {account.type === "credit" ? "-" : ""}
                        {formatCurrency(account.current_balance)}
                      </p>
                      {account.type === "credit" && account.credit_limit && (
                        <p className="text-xs text-gray-500">
                          of {formatCurrency(account.credit_limit)} limit
                        </p>
                      )}
                      {account.available_balance !== null &&
                        account.type !== "credit" && (
                          <p className="text-xs text-gray-500">
                            {formatCurrency(account.available_balance)}{" "}
                            available
                          </p>
                        )}
                    </div>
                  </div>
                  {account.type === "credit" && account.credit_limit && (
                    <div className="mt-3">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            account.current_balance / account.credit_limit > 0.7
                              ? "bg-red-500"
                              : "bg-green-500"
                          }`}
                          initial={{ width: 0 }}
                          animate={{
                            width: `${
                              (account.current_balance / account.credit_limit) *
                              100
                            }%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {Math.round(
                          (account.current_balance / account.credit_limit) * 100
                        )}
                        % used
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            {!plaidConnections.hasActive && userId && (
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
            <div className="space-y-2">
              {transactions.map((txn) => (
                <motion.div
                  key={txn.id}
                  className="noor-card px-4 py-3 flex items-center justify-between"
                  whileHover={{ scale: 1.01 }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">
                      {CATEGORY_ICONS[txn.category[0]] || "💰"}
                    </span>
                    <div>
                      <p className="font-medium text-black text-sm">
                        {txn.merchant_name || txn.name}
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
                      txn.amount < 0 ? "text-green-600" : "text-black"
                    }`}
                  >
                    {txn.amount < 0 ? "+" : "-"}
                    {formatCurrency(Math.abs(txn.amount))}
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
                {formatCurrency(totalSubscriptions)}/mo
              </p>
              <p className="text-black/70 text-sm mt-2">
                {formatCurrency(totalSubscriptions * 12)}/year
              </p>
            </div>

            {/* Subscription List */}
            <div className="space-y-2">
              {subscriptions.length > 0 ? (
                subscriptions.map((sub, i) => (
                  <motion.div
                    key={i}
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
                        <p className="font-medium text-black">{sub.name}</p>
                        <p className="text-xs text-gray-500">
                          {sub.last_charged
                            ? `Last charged ${new Date(
                                sub.last_charged
                              ).toLocaleDateString()}`
                            : "Recent recurring charge"}
                        </p>
                        {sub.next_charge && (
                          <p className="text-xs text-gray-500">
                            Next expected{" "}
                            {new Date(sub.next_charge).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="font-semibold text-black">
                      {formatCurrency(sub.monthly_amount)}/mo
                    </p>
                  </motion.div>
                ))
              ) : (
                <div className="noor-card p-8 text-center">
                  <p className="text-gray-500">No subscriptions detected</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Connect your accounts to detect subscriptions automatically
                  </p>
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
