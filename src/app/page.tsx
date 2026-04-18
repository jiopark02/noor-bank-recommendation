"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { PageLayout } from "@/components/layout";
import { useTheme } from "@/contexts/ThemeContext";
import {
  buildJsonAuthorizedHeaders,
  getSupabaseBearerHeaders,
} from "@/lib/supabaseAuthHeaders";
import { asPlainObject, readErrorMessage } from "@/lib/requestJson";

interface StoredBudget {
  total?: number;
  spent?: number;
}

interface StoredPlaidAccount {
  type?: string;
  current_balance?: number;
}

interface StoredPlaidTransaction {
  amount?: number;
  category?: string[];
  name?: string;
}

interface StoredPlaidSubscription {
  name?: string;
  amount?: number;
  monthly_amount?: number;
}

const STORAGE_KEY_BUDGET = "noor_budget";
const STORAGE_KEY_ACCOUNTS = "noor_plaid_accounts";
const STORAGE_KEY_TRANSACTIONS = "noor_plaid_transactions";

const QUICK_PROMPTS = [
  "How much can I spend this week?",
  "Am I on track this month?",
];

function hexToRgba(hex: string, alpha: number): string {
  const safeHex = hex.replace("#", "").trim();
  if (safeHex.length !== 3 && safeHex.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const fullHex =
    safeHex.length === 3
      ? `${safeHex[0]}${safeHex[0]}${safeHex[1]}${safeHex[1]}${safeHex[2]}${safeHex[2]}`
      : safeHex;

  const int = Number.parseInt(fullHex, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export default function HomePage() {
  const router = useRouter();
  const { theme, useSchoolTheme } = useTheme();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [moneyError, setMoneyError] = useState<string | null>(null);
  const [hasBankConnection, setHasBankConnection] = useState(false);
  const [userName, setUserName] = useState("there");
  const [promptDraft, setPromptDraft] = useState("");
  const [budget, setBudget] = useState<StoredBudget>({ total: 0, spent: 0 });
  const [accounts, setAccounts] = useState<StoredPlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<StoredPlaidTransaction[]>(
    []
  );
  const [subscriptions, setSubscriptions] = useState<StoredPlaidSubscription[]>(
    []
  );

  useEffect(() => {
    const storedUserId = localStorage.getItem("noor_user_id");
    if (!storedUserId) {
      router.replace("/welcome");
      window.setTimeout(() => {
        if (window.location.pathname === "/") {
          window.location.href = "/welcome";
        }
      }, 400);
      return;
    }
    setUserId(storedUserId);

    try {
      const profileRaw = localStorage.getItem("noor_user_profile");
      if (profileRaw) {
        const parsed = JSON.parse(profileRaw) as { firstName?: string };
        if (parsed.firstName?.trim()) {
          setUserName(parsed.firstName.trim());
        }
      }
    } catch {
      // Ignore profile parse errors.
    }

    try {
      const budgetRaw = localStorage.getItem(STORAGE_KEY_BUDGET);
      if (budgetRaw) {
        const parsed = JSON.parse(budgetRaw) as StoredBudget;
        if (typeof parsed.total === "number" && parsed.total > 0) {
          setBudget({
            total: parsed.total,
            spent: typeof parsed.spent === "number" ? parsed.spent : 0,
          });
        }
      }
    } catch {
      // Ignore budget parse errors.
    }

    let hasActiveConnection = false;
    try {
      const storedConnections = localStorage.getItem("noor_plaid_connections");
      if (storedConnections) {
        const parsed = JSON.parse(storedConnections) as Array<{
          status?: string;
        }>;
        hasActiveConnection = parsed.some(
          (connection) => connection.status === "active"
        );
      }
    } catch {
      // Ignore connection parse errors.
    }

    setHasBankConnection(hasActiveConnection);

    if (hasActiveConnection) {
      try {
        const storedAccountsRaw = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
        const storedTxRaw = localStorage.getItem(STORAGE_KEY_TRANSACTIONS);

        if (storedAccountsRaw) {
          const parsedAccounts = JSON.parse(storedAccountsRaw) as unknown;
          if (Array.isArray(parsedAccounts)) {
            setAccounts(parsedAccounts as StoredPlaidAccount[]);
          }
        }

        if (storedTxRaw) {
          const parsedTx = JSON.parse(storedTxRaw) as unknown;
          if (Array.isArray(parsedTx)) {
            setTransactions(parsedTx as StoredPlaidTransaction[]);
          }
        }
      } catch {
        // Ignore cache parse errors.
      }
    } else {
      setAccounts([]);
      setTransactions([]);
      setSubscriptions([]);
      localStorage.removeItem(STORAGE_KEY_ACCOUNTS);
      localStorage.removeItem(STORAGE_KEY_TRANSACTIONS);
    }

    setIsLoading(false);
  }, [router]);

  const fetchLiveMoneyData = useCallback(async () => {
    if (!userId || !hasBankConnection) {
      setAccounts([]);
      setTransactions([]);
      setSubscriptions([]);
      return;
    }

    setIsLoadingData(true);
    setMoneyError(null);

    try {
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const plaidHeaders = buildJsonAuthorizedHeaders(
        await getSupabaseBearerHeaders()
      );

      const [accountsRes, transactionsRes] = await Promise.all([
        fetch("/api/plaid/accounts", {
          method: "POST",
          headers: plaidHeaders,
          body: JSON.stringify({}),
        }),
        fetch("/api/plaid/transactions", {
          method: "POST",
          headers: plaidHeaders,
          body: JSON.stringify({ startDate, endDate }),
        }),
      ]);

      if (!accountsRes.ok) {
        const data = asPlainObject(
          await accountsRes.json().catch(() => ({}))
        );
        throw new Error(readErrorMessage(data) || "Failed to fetch accounts");
      }

      if (!transactionsRes.ok) {
        const data = asPlainObject(
          await transactionsRes.json().catch(() => ({}))
        );
        throw new Error(
          readErrorMessage(data) || "Failed to fetch transactions"
        );
      }

      const accountsData = asPlainObject(await accountsRes.json());
      const transactionsData = asPlainObject(await transactionsRes.json());

      const nextAccounts = Array.isArray(accountsData.accounts)
        ? accountsData.accounts
        : [];
      const nextTransactions = Array.isArray(transactionsData.transactions)
        ? transactionsData.transactions
        : [];
      const nextSubscriptions = Array.isArray(transactionsData.subscriptions)
        ? transactionsData.subscriptions
        : [];

      setAccounts(nextAccounts);
      setTransactions(nextTransactions);
      setSubscriptions(nextSubscriptions);

      localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(nextAccounts));
      localStorage.setItem(
        STORAGE_KEY_TRANSACTIONS,
        JSON.stringify(nextTransactions)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sync bank data";
      setMoneyError(message);

      // If backend reports no active bank connections, clear stale local data.
      if (/no active bank connection/i.test(message)) {
        setHasBankConnection(false);
        setAccounts([]);
        setTransactions([]);
        setSubscriptions([]);
        localStorage.removeItem("noor_plaid_connections");
        localStorage.removeItem(STORAGE_KEY_ACCOUNTS);
        localStorage.removeItem(STORAGE_KEY_TRANSACTIONS);
      }
    } finally {
      setIsLoadingData(false);
    }
  }, [userId, hasBankConnection]);

  useEffect(() => {
    if (!isLoading) {
      fetchLiveMoneyData();
    }
  }, [isLoading, fetchLiveMoneyData]);

  const metrics = useMemo(() => {
    const cash = accounts
      .filter(
        (account) => account.type === "checking" || account.type === "savings"
      )
      .reduce((sum, account) => sum + (account.current_balance || 0), 0);

    const creditUsed = accounts
      .filter((account) => account.type === "credit")
      .reduce((sum, account) => sum + (account.current_balance || 0), 0);

    const spending = transactions
      .filter((txn) => (txn.amount || 0) > 0)
      .reduce((sum, txn) => sum + (txn.amount || 0), 0);

    const income = transactions
      .filter((txn) => (txn.amount || 0) < 0)
      .reduce((sum, txn) => sum + Math.abs(txn.amount || 0), 0);

    const netWorth = cash - creditUsed;
    const totalBudget = budget.total && budget.total > 0 ? budget.total : 0;
    const budgetSpent =
      typeof budget.spent === "number" && budget.spent > 0
        ? budget.spent
        : spending;
    const budgetRemaining =
      totalBudget > 0 ? Math.max(0, totalBudget - budgetSpent) : 0;

    const categoryMap: Record<string, number> = {};
    transactions
      .filter((txn) => (txn.amount || 0) > 0)
      .forEach((txn) => {
        const category = txn.category?.[0] || "Other";
        categoryMap[category] =
          (categoryMap[category] || 0) + (txn.amount || 0);
      });

    const categorySpending = Object.entries(categoryMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const inferredSubscriptions = transactions.filter((txn) => {
      const amount = txn.amount || 0;
      if (amount <= 0) return false;

      const categoryText = (txn.category || []).join(" ").toLowerCase();
      const nameText = (txn.name || "").toLowerCase();
      return (
        categoryText.includes("subscription") ||
        /netflix|spotify|apple|prime|adobe|hulu|youtube|google/i.test(nameText)
      );
    });

    const normalizedSubscriptions =
      subscriptions.length > 0
        ? subscriptions
            .map((sub) => ({
              name: sub.name || "Subscription",
              amount:
                typeof sub.monthly_amount === "number"
                  ? sub.monthly_amount
                  : sub.amount || 0,
            }))
            .filter((sub) => sub.amount > 0)
        : inferredSubscriptions.map((txn) => ({
            name: txn.name || "Subscription",
            amount: txn.amount || 0,
          }));

    const totalSubscriptions = normalizedSubscriptions.reduce(
      (sum, sub) => sum + sub.amount,
      0
    );

    return {
      cash,
      creditUsed,
      netWorth,
      spending,
      income,
      budgetRemaining,
      categorySpending,
      subscriptions: normalizedSubscriptions,
      totalSubscriptions,
    };
  }, [accounts, transactions, budget, subscriptions]);

  const displayMetrics = useMemo(() => {
    if (!hasBankConnection) {
      return {
        cash: 0,
        creditUsed: 0,
        netWorth: 0,
        spending: 0,
        income: 0,
        budgetRemaining: 0,
        categorySpending: [] as Array<{ name: string; amount: number }>,
        subscriptions: [] as Array<{ name: string; amount: number }>,
        totalSubscriptions: 0,
      };
    }

    return metrics;
  }, [hasBankConnection, metrics]);

  const aiSummary = useMemo(() => {
    if (isLoadingData) {
      return {
        opening:
          "Syncing your Plaid data now. I will calculate your safe cap in a moment.",
        question: "Can you show me a safe spending cap for this week?",
        answer:
          "I am updating your balances and recent transactions before giving a number.",
      };
    }

    if (moneyError) {
      return {
        opening: "I could not read your latest Plaid data due to a sync error.",
        question: "Can you show me a safe spending cap for this week?",
        answer:
          "Please reconnect or refresh your bank data in Money page and I will recalculate instantly.",
      };
    }

    if (!hasBankConnection) {
      return {
        opening:
          "Connect your bank account in Money page and I will calculate your spending cap from live Plaid data.",
        question: "Can you show me a safe spending cap for this week?",
        answer:
          "I need a connected account before I can estimate a safe weekly cap.",
      };
    }

    if (transactions.length === 0 && accounts.length === 0) {
      return {
        opening:
          "Your bank is connected, but there is not enough transaction history yet to compute a reliable cap.",
        question: "Can you show me a safe spending cap for this week?",
        answer:
          "Once Plaid returns recent activity, I will calculate this using your real cash flow.",
      };
    }

    const now = new Date();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = Math.max(1, daysInMonth - dayOfMonth + 1);
    const weeksRemaining = Math.max(1, Math.ceil(daysRemaining / 7));

    const averageDailySpending = metrics.spending / 30;
    const projectedRemainingSpend = averageDailySpending * daysRemaining;
    const subscriptionReserve = metrics.totalSubscriptions;
    const safetyReserve = Math.max(150, metrics.cash * 0.2);
    const spendableThisMonth = Math.max(
      0,
      metrics.cash -
        projectedRemainingSpend -
        subscriptionReserve -
        safetyReserve
    );
    const weeklyCap = Math.max(0, spendableThisMonth / weeksRemaining);

    return {
      opening: `Good day, ${userName}. Based on your balances and recent spending, you can safely spend ${formatMoney(
        spendableThisMonth
      )} for the rest of this month while keeping a reserve of ${formatMoney(
        safetyReserve
      )}.`,
      question: "Can you show me a safe spending cap for this week?",
      answer: `Using your recent run rate (${formatMoney(
        averageDailySpending
      )}/day) and ${daysRemaining} day(s) left this month, a safe weekly cap is about ${formatMoney(
        weeklyCap
      )}.`,
    };
  }, [
    isLoadingData,
    moneyError,
    hasBankConnection,
    transactions,
    accounts,
    metrics,
    userName,
  ]);

  const accentColor = useSchoolTheme ? theme.primary_color : "#111111";
  const accentTextColor =
    useSchoolTheme && theme.text_on_primary === "black" ? "#111111" : "#FFFFFF";
  const accentSoftBg = useMemo(
    () => hexToRgba(accentColor, 0.1),
    [accentColor]
  );

  const submitPrompt = (rawPrompt?: string) => {
    const text = (rawPrompt ?? promptDraft).trim();
    if (!text) return;
    localStorage.setItem("noor_quick_prompt", text);
    router.push("/chat");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-sm text-gray-500">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <PageLayout userName={userName}>
      <motion.header
        className="mb-10"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl font-semibold text-black">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          A minimal view of your assistant and money overview.
        </p>
      </motion.header>

      <section className="grid gap-8 xl:grid-cols-2">
        <motion.div
          className="noor-card p-8 flex flex-col min-h-[620px]"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-black">
                AI Assistant
              </h2>
            </div>
          </div>

          <div className="mt-8 flex-1 space-y-5">
            <div className="rounded-2xl bg-gray-100 px-4 py-3 max-w-[92%]">
              <p className="text-sm text-gray-700 leading-relaxed">
                {aiSummary.opening}
              </p>
            </div>

            <div
              className="rounded-2xl px-4 py-3 ml-auto max-w-[92%]"
              style={{ backgroundColor: accentColor }}
            >
              <p
                className="text-sm leading-relaxed"
                style={{ color: accentTextColor }}
              >
                {aiSummary.question}
              </p>
            </div>

            <div className="rounded-2xl bg-gray-100 px-4 py-3 max-w-[92%]">
              <p className="text-sm text-gray-700 leading-relaxed">
                {aiSummary.answer}
              </p>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100">
            <div className="flex flex-wrap gap-2 mb-5">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => submitPrompt(prompt)}
                  className="px-4 py-2 rounded-full text-xs border border-gray-200 text-gray-700 hover:border-gray-300 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitPrompt();
                  }
                }}
                placeholder="Ask about your money..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black"
              />
              <button
                onClick={() => submitPrompt()}
                className="w-11 h-11 rounded-xl text-white flex items-center justify-center transition-colors"
                style={{ backgroundColor: accentColor, color: accentTextColor }}
                aria-label="Open chat"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14m-6-6 6 6-6 6"
                  />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="space-y-5"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
        >
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-black">Money</h2>
              <p className="text-gray-500 text-sm">
                All your finances in one place
              </p>
            </div>

            {isLoadingData && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                Syncing your latest bank data...
              </div>
            )}

            {!isLoadingData && moneyError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {moneyError}
              </div>
            )}

            {!isLoadingData && !moneyError && !hasBankConnection && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                No active bank connection found. Connect your bank in Money page
                to show live data.
              </div>
            )}

            <div className="noor-card p-6 mb-5">
              <p className="text-gray-500 text-sm mb-1">Net Worth</p>
              <p className="text-4xl font-semibold text-black mb-4">
                {formatMoney(displayMetrics.netWorth)}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-500 text-xs">Cash</p>
                  <p
                    className="text-lg font-medium"
                    style={{ color: accentColor }}
                  >
                    {formatMoney(displayMetrics.cash)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Credit Used</p>
                  <p className="text-lg font-medium text-red-600">
                    -{formatMoney(displayMetrics.creditUsed)}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Income</p>
                <p
                  className="text-xl font-semibold"
                  style={{ color: accentColor }}
                >
                  +{formatMoney(displayMetrics.income)}
                </p>
              </div>
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Spending</p>
                <p className="text-xl font-semibold text-red-600">
                  -{formatMoney(displayMetrics.spending)}
                </p>
              </div>
            </div>

            <div className="noor-card p-5 mb-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-black">
                  Monthly Subscriptions
                </h3>
                <span className="text-lg font-semibold text-black">
                  {formatMoney(displayMetrics.totalSubscriptions)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {displayMetrics.subscriptions.length > 0 ? (
                  displayMetrics.subscriptions.slice(0, 2).map((sub, idx) => (
                    <span
                      key={`${sub.name || "subscription"}-${idx}`}
                      className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                    >
                      {sub.name || "Subscription"} ·{" "}
                      {formatMoney(sub.amount || 0)}/mo
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-500">
                    No subscriptions detected
                  </span>
                )}
              </div>
            </div>

            <Link
              href="/money"
              className="inline-flex items-center rounded-full px-4 py-2 text-sm font-medium border border-gray-200 text-black hover:border-gray-300"
            >
              Open Money
            </Link>
          </div>
        </motion.div>
      </section>
    </PageLayout>
  );
}
