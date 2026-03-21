import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  isPlaidConfigured,
  PlaidTransaction,
  detectSubscription,
} from "@/lib/plaid";
import {
  authenticate,
  getPlaidConnection,
  updatePlaidConnectionStatus,
  handlePlaidError,
} from "@/lib/plaidApiUtils";

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: "Plaid is not configured" },
        { status: 503 }
      );
    }

    // Authenticate user
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, body } = auth;
    const { startDate, endDate } = body;

    // Get connection from database
    const connection = await getPlaidConnection(userId);
    if (!connection) {
      return NextResponse.json(
        {
          error:
            "No active bank connections found. Please connect a bank first.",
        },
        { status: 404 }
      );
    }

    const accessToken = connection.access_token;

    // Default to last 30 days if no dates provided
    const end = endDate || new Date().toISOString().split("T")[0];
    const start =
      startDate ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    try {
      // Get transactions from Plaid
      const transactionsResponse = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: start,
        end_date: end,
        options: {
          include_personal_finance_category: true,
        },
      });

      // Format transactions
      const transactions: PlaidTransaction[] =
        transactionsResponse.data.transactions.map((txn) => ({
          id: `plaid_${txn.transaction_id}`,
          user_id: userId,
          account_id: txn.account_id,
          transaction_id: txn.transaction_id,
          amount: txn.amount,
          iso_currency_code: txn.iso_currency_code || "USD",
          date: txn.date,
          datetime: txn.datetime || null,
          name: txn.name,
          merchant_name: txn.merchant_name || null,
          category: txn.category || [],
          category_id: txn.category_id || null,
          pending: txn.pending,
          payment_channel: txn.payment_channel as
            | "online"
            | "in store"
            | "other",
          logo_url: txn.logo_url || null,
          created_at: new Date().toISOString(),
        }));

      // Detect subscriptions
      const subscriptions = transactions
        .filter((txn) => {
          const { isSubscription } = detectSubscription(txn);
          return isSubscription;
        })
        .map((txn) => {
          const { merchant, category } = detectSubscription(txn);
          return {
            ...txn,
            subscription_merchant: merchant,
            subscription_category: category,
          };
        });

      // Calculate category totals
      const categoryTotals: Record<string, number> = {};
      transactions.forEach((txn) => {
        if (txn.amount > 0) {
          // Positive amounts are expenses in Plaid
          const category = txn.category[0] || "Other";
          categoryTotals[category] =
            (categoryTotals[category] || 0) + txn.amount;
        }
      });

      // Calculate totals
      const totalSpending = transactions
        .filter((txn) => txn.amount > 0)
        .reduce((sum, txn) => sum + txn.amount, 0);

      const totalIncome = transactions
        .filter((txn) => txn.amount < 0)
        .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

      return NextResponse.json({
        success: true,
        transactions,
        subscriptions,
        categoryTotals,
        summary: {
          totalSpending,
          totalIncome,
          netCashFlow: totalIncome - totalSpending,
          transactionCount: transactions.length,
          startDate: start,
          endDate: end,
        },
      });
    } catch (plaidError: unknown) {
      // Check if it's a login required error
      const errorMessage =
        plaidError instanceof Error ? plaidError.message : "Unknown error";
      if (
        errorMessage.includes("ITEM_LOGIN_REQUIRED") ||
        errorMessage.includes("invalid access token")
      ) {
        // Mark connection as broken
        await updatePlaidConnectionStatus(userId, connection.item_id, "error");
        return NextResponse.json(
          {
            error: "Bank connection expired. Please re-link your account.",
            errorType: "ITEM_LOGIN_REQUIRED",
          },
          { status: 401 }
        );
      }
      throw plaidError;
    }
  } catch (error: unknown) {
    console.error("Error fetching transactions:", error);
    return handlePlaidError(error);
  }
}
