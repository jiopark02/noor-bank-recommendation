import { NextRequest, NextResponse } from "next/server";
import { isPlaidConfigured } from "@/lib/plaid";
import {
  authenticate,
  getAllPlaidConnections,
  handlePlaidError,
} from "@/lib/plaidApiUtils";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import { computeFinancialSummary } from "@/lib/financeEngine";
import {
  bankWindow,
  liveAdapterDeps,
  readBankData,
  toDisplayAccount,
  toEngineInput,
  type FinanceSummaryResponse,
} from "@/lib/plaidEngineAdapter";

/**
 * POST /api/finance/summary
 *
 * The money figures the dashboard and the money screen show: the signed-in
 * user's accounts, the finance engine's summary over them, and each bank
 * connection's status. Every amount on those screens comes from here; the
 * screens only format it.
 *
 * Takes no input. The user is the verified token's user, and the request body
 * is ignored.
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

    const now = new Date();
    const range = bankWindow(now);
    const read = await readBankData(
      userId,
      activeConnections,
      { accounts: true, transactions: true, recurring: true },
      range,
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
        ? computeFinancialSummary(toEngineInput(read, now.toISOString(), range))
        : null,
    };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error("Error building finance summary:", error);
    return handlePlaidError(error);
  }
}
