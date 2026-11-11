import { NextRequest, NextResponse } from "next/server";
import { isPlaidConfigured } from "@/lib/plaid";
import {
  authenticate,
  getAllPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import { DISPLAY_WINDOW_DAYS } from "@/lib/bankSummaryView";
import {
  bankWindow,
  liveAdapterDeps,
  readBankData,
  resolveToday,
  type TransactionsListResponse,
} from "@/lib/plaidEngineAdapter";

/**
 * POST /api/plaid/transactions
 *
 * The signed-in user's transactions over the server's fixed window (the last
 * DISPLAY_WINDOW_DAYS days, ending on the user's today), every page of them,
 * with Plaid's personal finance category, plus each bank connection's status.
 * For listing only: totals and recurring charges come from POST
 * /api/finance/summary.
 *
 * The only body field read is `timeZone`, which decides the window's last
 * day as in the summary route. Dates in the request body are ignored, so a
 * caller cannot widen the window and multiply the Plaid calls a request makes.
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication first, before anything about configuration is revealed.
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isPlaidConfigured() || !isPlaidTokenCryptoConfigured()) {
      // Without PLAID_TOKEN_ENCRYPTION_KEY the stored access tokens cannot be
      // decrypted, so report the configuration fault here as a 503.
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    const { userId } = auth;
    const allConnections = await getAllPlaidConnections(userId);

    // null means the read failed, not that the user has no banks. Falling
    // through to the 404 below would report a database hiccup as "no bank
    // connected" — wording both money screens string-match. Throw to the outer
    // catch, which maps an error with no Plaid error_code to a generic 500.
    if (allConnections === null) {
      throw new Error("Failed to read Plaid connections");
    }

    const activeConnections = allConnections.filter((c) => c.status === "active");
    if (activeConnections.length === 0) {
      return NextResponse.json(
        {
          error:
            "No active bank connections found. Please connect a bank first.",
        },
        { status: 404 }
      );
    }

    const { today } = resolveToday(auth.body.timeZone, new Date());
    const range = bankWindow(today, DISPLAY_WINDOW_DAYS);
    const read = await readBankData(
      userId,
      activeConnections,
      { accounts: false, transactions: true, recurring: false },
      range,
      liveAdapterDeps()
    );

    // No bank read and at least one needs a new login: keep the long-standing
    // re-link answer, so "your bank needs re-authentication" is not shown as
    // "you have no transactions".
    const anyRead = read.connections.some((c) => c.status === "ok");
    const anyLoginRequired = read.connections.some(
      (c) => c.status === "login_required"
    );
    if (!anyRead && anyLoginRequired) {
      return NextResponse.json(
        {
          error: "Bank connection expired. Please re-link your account.",
          errorType: "ITEM_LOGIN_REQUIRED",
        },
        { status: 401 }
      );
    }

    const body: TransactionsListResponse = {
      success: true,
      transactions: read.transactions,
      connections: read.connections,
      period: { ...range, completeness: read.completeness },
    };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error("Error fetching transactions:", error);
    return handlePlaidError(error);
  }
}
