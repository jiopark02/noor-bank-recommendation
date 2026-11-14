"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { PageLayout } from "@/components/layout";
import { buildJsonAuthorizedHeaders } from "@/lib/supabaseAuthHeaders";
import { getSupabaseBearerHeaders, readSession } from "@/lib/supabase-browser";
import {
  DASHBOARD_SESSION_RETRY,
  decideDashboardMount,
  decideLocalIdentity,
  retryUntilAnswered,
  shouldRetrySessionRead,
  waitMs,
} from "@/lib/sessionFlow";
import {
  clearLocalAuthState,
  clearPlaidLocalState,
  replaceLocalIdentity,
} from "@/lib/validation";
import { asPlainObject, readErrorMessage } from "@/lib/requestJson";
import {
  BANK_SCREEN_FETCH_TIMEOUT_MS,
  withFetchTimeout,
} from "@/lib/screenFetchTimeout";
import {
  DISPLAY_WINDOW_LABEL,
  browserTimeZone,
  creditUsedCents,
  decideBankView,
  describeBankAction,
  formatCents,
  formatCalendarDay,
  formatCentsOrDash,
  HIDDEN_SAFE_TO_SPEND_ANSWER,
  formatMonthlyOrUnknown,
  formatSpending,
  missingBanksNote,
  parseFinanceSummaryResponse,
  safeToSpendHiddenReason,
  safeToSpendHorizonPhrase,
  spendableCashCents,
  spendableCashTile,
  summaryPeriodNote,
  NO_CASH_ACCOUNT_HINT,
  NO_CASH_ACCOUNT_LABEL,
  type MoneyDisplayState,
  type ScreenSummaryResponse,
} from "@/lib/bankSummaryView";

const CONNECTIONS_LOAD_FAILED = "Failed to load bank connections";
const BANK_DATA_LOAD_FAILED =
  "We couldn't load your bank data right now. Please try again in a moment.";

// A fetch that rejects and a 2xx body that does not parse are not something
// the server said, and the browser's or the parser's own wording is not for
// the screen. Both end as `message`; an error the server sent in a body is
// thrown by the callers, with its text, as before.
async function fetchOrFail(
  input: string,
  init: RequestInit,
  message: string
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(message);
  }
}

async function readJsonOrFail(res: Response, message: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new Error(message);
  }
}

function isPlainRecord(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const QUICK_PROMPTS = [
  "How much can I spend this week?",
  "Am I on track this month?",
];


// What the money figures can honestly show right now is decided by
// decideBankView (bankSummaryView.ts). Only "ready" and "none" may render a
// dollar amount. An unknown figure must not look like a real $0.
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

export default function HomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // The session read never answered, even after the retries. Nothing is known
  // about the session, so the page waits on the user instead of signing out.
  const [sessionDelayed, setSessionDelayed] = useState(false);
  // True only once the summary route has answered successfully in this visit.
  // Nothing else may make the figures "ready".
  const [hasMoneyData, setHasMoneyData] = useState(false);
  const [moneyError, setMoneyError] = useState<string | null>(null);
  const [hasBankConnection, setHasBankConnection] = useState(false);
  const [userName, setUserName] = useState("there");
  const [promptDraft, setPromptDraft] = useState("");
  // The summary route's answer for this visit. Every amount on this screen
  // comes from it; the screen only formats. Typed by the fields bankSummaryView
  // checks, so a field read here that is not checked there is a type error.
  const [bank, setBank] = useState<ScreenSummaryResponse | null>(null);

  useEffect(() => {
    // Bank data is never kept in browser storage; every figure comes from the
    // server on each visit. Earlier builds cached accounts, transactions and
    // connection details here, so drop whatever they left on this device. Runs
    // first, before any redirect or await, so every visit clears it.
    clearPlaidLocalState();

    const storedUserId = localStorage.getItem("noor_user_id");
    if (!storedUserId) {
      router.replace("/waitlist");
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

    // Determine bank-connection state from the DB (authoritative source), not
    // localStorage — so it survives a localStorage purge (logout / new device).
    // isLoading stays true until this resolves, so the UI never flashes a
    // "not connected" state before the check completes — and it stays true on
    // the redirect to /login, so a signed-out visit never shows $0 on its way
    // out.
    let cancelled = false;
    let redirecting = false;
    (async () => {
      try {
        // The authoritative auth signal is the live Supabase session, not the
        // legacy noor_user_id cache read above. If the session has expired, clear
        // the stale cache and send the user to /login instead of rendering the
        // dashboard and firing 401s at every money/Plaid endpoint. Only "none"
        // means that: a read that never answered can come from a valid session,
        // so it is retried, and it never clears anything.
        const read = await retryUntilAnswered(
          (timeoutMs, attempt) =>
            readSession(timeoutMs, "dashboard-mount", attempt),
          shouldRetrySessionRead,
          DASHBOARD_SESSION_RETRY,
          { sleep: waitMs, isCancelled: () => cancelled }
        );
        if (cancelled) return;
        const action = decideDashboardMount(read);
        if (action === "sign-out") {
          redirecting = true;
          clearLocalAuthState();
          router.replace("/login");
          return;
        }
        if (action === "show-delayed") {
          setSessionDelayed(true);
          return;
        }
        // A cached id left by another account on this device is replaced
        // with the session's user, not acted on: the session decides who is
        // signed in.
        if (
          read.status === "session" &&
          decideLocalIdentity(storedUserId, read.session.user.id) === "replace"
        ) {
          replaceLocalIdentity(read.session.user.id);
          setUserId(read.session.user.id);
          setUserName("there");
        }

        const connectionsHeaders = await getSupabaseBearerHeaders();
        // The request and its body read run under the screen's limit: an
        // answer that never comes ends in the error state below, not on the
        // loading state.
        const payload = await withFetchTimeout(
          BANK_SCREEN_FETCH_TIMEOUT_MS,
          async (signal) => {
            const res = await fetchOrFail(
              "/api/plaid/connections",
              {
                method: "GET",
                headers: connectionsHeaders,
                signal,
              },
              CONNECTIONS_LOAD_FAILED
            );
            if (!res.ok) {
              const data = asPlainObject(await res.json().catch(() => ({})));
              throw new Error(
                readErrorMessage(data) || CONNECTIONS_LOAD_FAILED
              );
            }
            // A 200 whose body does not parse is a failed read, not an empty
            // list, and the parser's own wording is not for the screen.
            return asPlainObject(
              await readJsonOrFail(res, CONNECTIONS_LOAD_FAILED)
            );
          }
        );
        if (cancelled) return;

        // The route always sends an array of objects, empty when the user has
        // no connections. Anything else is a failed read: read as "none" it
        // would show a connected user $0.00.
        if (!Array.isArray(payload.connections)) {
          throw new Error(CONNECTIONS_LOAD_FAILED);
        }
        if (!payload.connections.every(isPlainRecord)) {
          throw new Error(CONNECTIONS_LOAD_FAILED);
        }
        const list = payload.connections as Array<{ status?: string }>;
        const hasActiveConnection = list.some(
          (connection) => connection.status === "active"
        );
        setHasBankConnection(hasActiveConnection);

        if (!hasActiveConnection) {
          setBank(null);
        }
      } catch (err) {
        if (cancelled) return;
        // Transient connection-check failure: surface an error rather than
        // flipping to "not connected" (which would prompt a re-link and create
        // duplicate connection rows). moneyError also hides the connect prompt.
        setMoneyError(
          err instanceof Error ? err.message : CONNECTIONS_LOAD_FAILED
        );
      } finally {
        if (!cancelled && !redirecting) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const fetchLiveMoneyData = useCallback(async () => {
    if (!userId || !hasBankConnection) {
      setBank(null);
      return;
    }

    // Drop the previous answer first, so nothing from an earlier load is drawn
    // while this one runs or after it fails.
    setHasMoneyData(false);
    setMoneyError(null);
    setBank(null);

    try {
      const plaidHeaders = buildJsonAuthorizedHeaders(
        await getSupabaseBearerHeaders()
      );

      // The request and its body read run under the screen's limit, so a
      // summary that never answers ends as a failed load, not on the loading
      // state.
      await withFetchTimeout(BANK_SCREEN_FETCH_TIMEOUT_MS, async (signal) => {
        const summaryRes = await fetchOrFail(
          "/api/finance/summary",
          {
            method: "POST",
            headers: plaidHeaders,
            body: JSON.stringify({ timeZone: browserTimeZone() }),
            signal,
          },
          BANK_DATA_LOAD_FAILED
        );

        if (!summaryRes.ok) {
          const data = asPlainObject(await summaryRes.json().catch(() => ({})));
          throw new Error(readErrorMessage(data) || BANK_DATA_LOAD_FAILED);
        }

        // A 2xx body of the wrong shape is a failed read, never an empty one:
        // read as empty it would show $0.00 as if it were the user's real
        // figure.
        const parsed = parseFinanceSummaryResponse(
          await readJsonOrFail(summaryRes, BANK_DATA_LOAD_FAILED)
        );
        if (parsed === null) {
          throw new Error(BANK_DATA_LOAD_FAILED);
        }

        setBank(parsed);
        setHasMoneyData(true);
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sync bank data";

      if (/no active bank connection/i.test(message)) {
        // Not a failed read: the route answers this only after reading the
        // connections and finding none active (a failed read is a generic
        // 500). Show the no-connection state, not an error, and clear only
        // what this screen holds in memory.
        setMoneyError(null);
        setHasBankConnection(false);
        setBank(null);
      } else {
        setMoneyError(message);
      }
    }
  }, [userId, hasBankConnection]);

  useEffect(() => {
    if (!isLoading) {
      fetchLiveMoneyData();
    }
  }, [isLoading, fetchLiveMoneyData]);

  const view = decideBankView({
    hasActiveConnection: hasBankConnection,
    fetchState: moneyError ? "failed" : hasMoneyData ? "loaded" : "loading",
    response: bank,
  });
  const moneyDisplay: MoneyDisplayState = view.figures;
  const summary = view.figures === "ready" && bank ? bank.summary : null;
  const missingNote = missingBanksNote(view.missingFrom);
  const periodNote = summaryPeriodNote(view, bank);

  // Engine figures as they arrived. With no connection the zeros are true.
  // The spendable-cash amount is null (a dash) when safe-to-spend was not
  // computed; with no checking account the tile names that instead.
  const cashTile = spendableCashTile(summary);
  const noCashAccount = cashTile.kind === "no_cash_account";
  const figures = {
    cash: spendableCashCents(cashTile),
    creditUsed: summary ? creditUsedCents(summary) : 0,
    income: summary ? summary.cashFlow.incomeCents : 0,
    spending: summary ? summary.cashFlow.spendingNetCents : 0,
    recurringMonthly: summary ? summary.recurring.totalMonthlyCents : 0,
    recurringItems: summary ? summary.recurring.items : [],
  };

  const aiSummary = useMemo(() => {
    const question = "How much can I safely spend this month?";

    // Keyed on the display state rather than an in-flight flag: between the
    // connection check and the start of the sync there is a render with no
    // request running, and it must not read as "connected, no history yet".
    if (moneyDisplay === "loading") {
      return {
        opening: "Syncing your bank data now. I'll have your numbers in a moment.",
        question,
        answer:
          "I'm updating your balances and recent transactions before giving a number.",
      };
    }

    if (moneyError) {
      return {
        opening: "I couldn't read your latest bank data.",
        question,
        // A failed read, not a broken connection: re-link advice comes only
        // from a connection status in the summary, never from a failed load.
        answer:
          "I couldn't load your bank data right now. Try refreshing in a moment.",
      };
    }

    if (!hasBankConnection) {
      return {
        opening:
          "Connect your bank account on the Money page and I'll work out what you can spend from your real balances.",
        question,
        answer: "I need a connected account before I can give you a number.",
      };
    }

    const fixes = view.actions.map(describeBankAction).join(" ");

    if (!summary) {
      return {
        opening: "I couldn't read any of your banks just now.",
        question,
        answer: fixes || "Try refreshing in a moment.",
      };
    }

    const hidden = safeToSpendHiddenReason(view, summary);
    if (!view.showSafeToSpend) {
      if (hidden === "banks_not_read") {
        return {
          opening: `Good day, ${userName}. Not every bank synced, so I'm not giving a spending number yet: it could miss a card balance.`,
          question,
          answer: `${fixes} Once that's fixed I'll include every account.`,
        };
      }
      return {
        opening: `Good day, ${userName}.`,
        question,
        answer: HIDDEN_SAFE_TO_SPEND_ANSWER[hidden ?? "other"],
      };
    }

    const s = summary.safeToSpend;
    if (hidden !== null || s.horizon === null || s.totals === null) {
      return {
        opening: `Good day, ${userName}.`,
        question,
        answer: HIDDEN_SAFE_TO_SPEND_ANSWER[hidden ?? "other"],
      };
    }

    const amount = s.amountCents ?? 0;
    const reach = safeToSpendHorizonPhrase(s.horizon);
    const dueReach =
      s.horizon.rule === "next_income_date" ? reach : `by ${formatCalendarDay(s.horizon.to)}`;
    const parts = [
      `your spendable cash of ${formatCents(s.totals.spendableCashCents)}`,
      `less ${formatCents(s.totals.upcomingRecurringCents)} in recurring charges due ${dueReach}`,
      `and ${formatCents(s.totals.reservedCreditCents)} in card balances`,
    ];
    if (s.totals.bufferCents > 0) {
      parts.push(`and a ${formatCents(s.totals.bufferCents)} buffer`);
    }
    const noRecurring =
      s.assumptions.indexOf("recurring_unavailable") >= 0
        ? " This doesn't include recurring charges, which I couldn't read yet."
        : "";

    return {
      opening:
        amount >= 0
          ? `Good day, ${userName}. After upcoming recurring charges and your card balances, you have about ${formatCents(amount)} to spend ${reach}.`
          : `Good day, ${userName}. Your upcoming charges and card balances are ${formatCents(
              s.uncoveredObligationsCents ?? -amount
            )} more than your spendable cash ${reach}.`,
      question,
      answer: `That's ${parts.join(", ")}.${noRecurring}`,
    };
  }, [moneyDisplay, moneyError, hasBankConnection, summary, view, userName]);

  const accentColor = "#111111";
  const accentTextColor = "#FFFFFF";
  const openFullChat = () => {
    router.push("/chat");
  };

  const submitPrompt = (rawPrompt?: string) => {
    const text = (rawPrompt ?? promptDraft).trim();
    if (!text) return;
    localStorage.setItem("noor_quick_prompt", text);
    router.push("/chat");
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
    <PageLayout>
      <motion.header
        className="mb-8 md:mb-10"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl font-semibold text-black tracking-tight">
          Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Your assistant and money overview in one place.
        </p>
      </motion.header>

      <section className="flex flex-col gap-6">
        <motion.div
          className="noor-card p-6 md:p-8 flex flex-col w-full min-h-[420px]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-2xl font-semibold text-black">AI Assistant</h2>
            <button
              type="button"
              onClick={openFullChat}
              aria-label="Open full chat"
              className="p-2 rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors shrink-0"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
                />
              </svg>
            </button>
          </div>

          <div className="mt-6 flex-1 space-y-5 min-h-[240px] overflow-y-auto">
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
        >
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-black">Money</h2>
              <p className="text-gray-500 text-sm">
                All your finances in one place
              </p>
            </div>

            {moneyDisplay === "loading" && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                Syncing your latest bank data...
              </div>
            )}

            {moneyDisplay === "unavailable" && (
              <div className="mb-4 rounded-xl border border-red-200 bg-rose-50 px-4 py-3 text-sm text-red-800">
                {moneyError ?? "We couldn't read any of your banks just now."}
              </div>
            )}

            {moneyDisplay === "none" && (
              <div className="mb-4 rounded-xl border border-red-200 bg-rose-50 px-4 py-3 text-sm text-red-800">
                No active bank connections found. Please connect a bank first.
              </div>
            )}

            {view.actions.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
                {view.actions.map((action) => (
                  <div
                    key={action.itemId}
                    className="flex items-center justify-between gap-3"
                  >
                    <p>{describeBankAction(action)}</p>
                    {action.kind === "relink" && (
                      <Link
                        href="/money"
                        className="shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Fix connection
                      </Link>
                    )}
                    {action.kind === "retry" && (
                      <button
                        type="button"
                        onClick={() => fetchLiveMoneyData()}
                        className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="noor-card p-6 mb-5">
              {missingNote && (
                <p className="text-xs text-amber-800 mb-3">{missingNote}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-500 text-xs">Spendable cash</p>
                  <p
                    className={
                      noCashAccount && moneyDisplay === "ready"
                        ? "text-base font-semibold"
                        : "text-2xl font-semibold"
                    }
                    style={{ color: accentColor }}
                  >
                    <MoneyFigure state={moneyDisplay}>
                      {noCashAccount ? NO_CASH_ACCOUNT_LABEL : formatCentsOrDash(figures.cash)}
                    </MoneyFigure>
                  </p>
                  {noCashAccount && moneyDisplay === "ready" && (
                    <p className="text-xs text-gray-500 mt-1">
                      {NO_CASH_ACCOUNT_HINT}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Credit card balances</p>
                  <p className="text-2xl font-semibold text-red-600">
                    <MoneyFigure state={moneyDisplay}>
                      {formatCentsOrDash(figures.creditUsed)}
                    </MoneyFigure>
                  </p>
                </div>
              </div>
            </div>

            <p className="text-gray-500 text-xs mb-2">{DISPLAY_WINDOW_LABEL}</p>
            {periodNote && (
              <p className="text-xs text-amber-800 mb-2">{periodNote}</p>
            )}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Income</p>
                <p
                  className="text-xl font-semibold"
                  style={{ color: accentColor }}
                >
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

            <div className="noor-card p-5 mb-5">
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
              <div className="flex flex-wrap gap-2">
                {moneyDisplay === "loading" || moneyDisplay === "unavailable" ? (
                  <span className="text-sm text-gray-500">
                    <MoneyFigure state={moneyDisplay}>{null}</MoneyFigure>
                  </span>
                ) : figures.recurringMonthly === null ? (
                  <span className="text-sm text-gray-500">
                    We couldn&apos;t read your recurring charges yet.
                  </span>
                ) : figures.recurringItems.length > 0 ? (
                  figures.recurringItems.slice(0, 2).map((item) => (
                    <span
                      key={item.streamId}
                      className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                    >
                      {item.label} · {formatCentsOrDash(item.monthlyCents)}/mo
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-500">
                    No recurring charges detected
                  </span>
                )}
              </div>
            </div>

            <Link
              href="/money"
              className="inline-flex items-center rounded-full px-5 py-2.5 text-sm font-medium border-[1.5px] border-black text-black bg-white hover:bg-black hover:text-white transition-colors"
            >
              Open Money
            </Link>
          </div>
        </motion.div>
      </section>
    </PageLayout>
  );
}
