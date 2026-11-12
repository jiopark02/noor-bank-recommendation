import { NextRequest, NextResponse } from "next/server";
import { isPlaidConfigured } from "@/lib/plaid";
import {
  authenticate,
  getAllPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import { computeFinancialSummary } from "@/lib/financeEngine";
import { DISPLAY_WINDOW_DAYS } from "@/lib/bankSummaryView";
import {
  READ_WINDOW_DAYS,
  bankWindow,
  displayTransactions,
  liveAdapterDeps,
  readBankData,
  resolveToday,
  toDisplayAccount,
  toEngineInput,
  type FinanceSummaryResponse,
} from "@/lib/plaidEngineAdapter";

/**
 * POST /api/finance/summary
 *
 * The money figures the dashboard and the money screen show: the signed-in
 * user's accounts, the finance engine's summary over them, the transactions
 * of the display window, and each bank connection's status. Every amount on
 * those screens comes from here; the screens only format it.
 *
 * The user is the verified token's user. Two body fields are read:
 *   - `timeZone`, the browser's IANA zone: it decides which calendar date is
 *     "today" for every date in the answer, and only for this user's own
 *     answer. A missing or unusable value falls back to the UTC date. The
 *     value is not logged or stored; the log line says only which basis was
 *     used.
 *   - `includeTransactions`: exactly `true` adds the transaction list to the
 *     answer, for the screen that shows it. Any other value leaves the field
 *     out. The banks are read the same way either way.
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication first, before anything about configuration is revealed.
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    const { userId } = auth;
    const includeTransactions = auth.body.includeTransactions === true;
    const allConnections = await getAllPlaidConnections(userId);

    // null means the read failed, not that the user has no banks. Both screens
    // string-match the 404 wording below, so a failed read goes to the outer
    // catch, which answers a generic 500 that neither screen matches.
    if (allConnections === null) {
      throw new Error("Failed to read Plaid connections");
    }

    const activeConnections = allConnections.filter(
      (c) => c.status === "active"
    );
    if (activeConnections.length === 0) {
      return NextResponse.json(
        {
          error:
            "No active bank connections found. Please connect a bank first.",
        },
        { status: 404 }
      );
    }

    // Read the clock and decide "today" once: the read window, the cash-flow
    // period and every date the engine works out come from this one date.
    const now = new Date();
    const { today, dateBasis } = resolveToday(auth.body.timeZone, now);
    console.log(
      `[finance-summary] date_basis=${dateBasis === "user_time_zone" ? "user" : "utc_fallback"}`
    );
    const readWindow = bankWindow(today, READ_WINDOW_DAYS);
    const period = bankWindow(today, DISPLAY_WINDOW_DAYS);
    const read = await readBankData(
      userId,
      activeConnections,
      { accounts: true, transactions: true, recurring: true },
      readWindow,
      liveAdapterDeps()
    );

    // With no bank read, there is nothing to compute: an engine run over empty
    // input would show real-looking zeros. The statuses still go back, so the
    // screens can say which bank needs attention.
    const anyRead = read.connections.some((c) => c.status === "ok");
    const body: FinanceSummaryResponse = {
      success: true,
      connections: read.connections,
      accounts: anyRead ? read.accounts.map(toDisplayAccount) : [],
      summary: anyRead
        ? computeFinancialSummary(
            toEngineInput(read, {
              nowIso: now.toISOString(),
              today,
              dateBasis,
              readWindow,
              period,
            })
          )
        : null,
    };
    // The list the money screen shows, from this same read and window: the
    // screen makes no second read of the transactions. Only a request that
    // asks for it gets it.
    if (includeTransactions) {
      body.transactions = anyRead ? displayTransactions(read, period) : [];
    }
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error("Error building finance summary:", error);
    return handlePlaidError(error);
  }
}
