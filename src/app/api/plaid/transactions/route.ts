import { NextRequest, NextResponse } from "next/server";
import {
  plaidClient,
  isPlaidConfigured,
  PlaidTransaction,
  detectSubscription,
} from "@/lib/plaid";
import {
  authenticate,
  getAllPlaidConnections,
  updatePlaidConnectionStatus,
  handlePlaidError,
} from "@/lib/plaidApiUtils";

type ApiSubscription = {
  id: string;
  name: string;
  amount: number;
  monthly_amount: number;
  iso_currency_code: string;
  frequency: "weekly" | "monthly" | "yearly" | "unknown";
  last_charged: string | null;
  next_charge: string | null;
  category: string | null;
  source: "plaid_recurring" | "heuristic";
};

function normalizeFrequency(
  rawFrequency: string | undefined
): ApiSubscription["frequency"] {
  if (!rawFrequency) return "unknown";

  const normalized = rawFrequency.toUpperCase();
  if (normalized.includes("WEEK")) return "weekly";
  if (
    normalized.includes("MONTH") ||
    normalized.includes("SEMIMONTH") ||
    normalized.includes("BIWEEK")
  ) {
    return "monthly";
  }
  if (normalized.includes("YEAR") || normalized.includes("ANNUAL")) {
    return "yearly";
  }

  return "unknown";
}

function toMonthlyAmount(
  amount: number,
  frequency: ApiSubscription["frequency"]
): number {
  if (frequency === "weekly") return amount * 4.33;
  if (frequency === "yearly") return amount / 12;
  return amount;
}

function isCashFlowRelevantTransaction(txn: PlaidTransaction): boolean {
  if (txn.pending) return false;

  const text = `${txn.name || ""} ${txn.merchant_name || ""}`.toLowerCase();
  const categories = (txn.category || []).map((c) => c.toLowerCase());

  const looksLikeInternalTransfer =
    categories.some((cat) =>
      /(transfer|credit card payment|loan payment|payment)/i.test(cat)
    ) ||
    /(transfer|credit card payment|loan payment|autopay payment|payment thank you)/i.test(
      text
    );

  return !looksLikeInternalTransfer;
}

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

    // Get active connections from database (all linked institutions)
    const allConnections = await getAllPlaidConnections(userId);
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

    // Default to last 30 days if no dates provided
    const end = endDate || new Date().toISOString().split("T")[0];
    const start =
      startDate ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    const allTransactions: PlaidTransaction[] = [];
    const recurringSubscriptions = new Map<string, ApiSubscription>();

    for (const connection of activeConnections) {
      const accessToken = connection.access_token;
      try {
        const transactionsResponse = await plaidClient.transactionsGet({
          access_token: accessToken,
          start_date: start,
          end_date: end,
          options: {
            include_personal_finance_category: true,
          },
        });

        const mappedTransactions: PlaidTransaction[] =
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

        allTransactions.push(...mappedTransactions);

        try {
          // Prefer Plaid recurring streams for more accurate subscription detection.
          const recurringResponse = (await (
            plaidClient as any
          ).transactionsRecurringGet({
            access_token: accessToken,
          })) as {
            data?: {
              outflow_streams?: Array<{
                stream_id?: string;
                merchant_name?: string | null;
                description?: string | null;
                average_amount?: {
                  amount?: number;
                  iso_currency_code?: string | null;
                };
                frequency?: string;
                last_date?: string | null;
                predicted_next_date?: string | null;
                personal_finance_category?: { primary?: string | null };
              }>;
            };
          };

          const outflowStreams = recurringResponse.data?.outflow_streams || [];
          outflowStreams.forEach((stream, index) => {
            const amount = Math.max(0, stream.average_amount?.amount || 0);
            if (amount <= 0) return;

            const frequency = normalizeFrequency(stream.frequency);
            const name =
              stream.merchant_name ||
              stream.description ||
              `Subscription ${index + 1}`;

            recurringSubscriptions.set(name.toLowerCase(), {
              id: stream.stream_id || `stream_${index}`,
              name,
              amount,
              monthly_amount: toMonthlyAmount(amount, frequency),
              iso_currency_code:
                stream.average_amount?.iso_currency_code || "USD",
              frequency,
              last_charged: stream.last_date || null,
              next_charge: stream.predicted_next_date || null,
              category: stream.personal_finance_category?.primary || null,
              source: "plaid_recurring" as const,
            });
          });
        } catch {
          // Fallback handled later.
        }
      } catch (plaidError: unknown) {
        const errorMessage =
          plaidError instanceof Error ? plaidError.message : "Unknown error";
        if (
          errorMessage.includes("ITEM_LOGIN_REQUIRED") ||
          errorMessage.includes("invalid access token")
        ) {
          await updatePlaidConnectionStatus(userId, connection.item_id, "error");
          continue;
        }
        throw plaidError;
      }
    }

    const transactions = Array.from(
      new Map(
        allTransactions.map((txn) => [
          `${txn.account_id}:${txn.transaction_id}`,
          txn,
        ])
      ).values()
    );

    let subscriptions: ApiSubscription[] = Array.from(
      recurringSubscriptions.values()
    );

      if (subscriptions.length === 0) {
        const fallbackByMerchant = new Map<string, ApiSubscription>();

        transactions
          .filter((txn) => txn.amount > 0)
          .forEach((txn) => {
            const { isSubscription, merchant, category } =
              detectSubscription(txn);
            if (!isSubscription) return;

            const name = merchant || txn.merchant_name || txn.name;
            const key = name.toLowerCase();
            const existing = fallbackByMerchant.get(key);

            if (!existing) {
              fallbackByMerchant.set(key, {
                id: `heuristic_${txn.transaction_id}`,
                name,
                amount: txn.amount,
                monthly_amount: txn.amount,
                iso_currency_code: txn.iso_currency_code || "USD",
                frequency: "monthly",
                last_charged: txn.date,
                next_charge: null,
                category: category || txn.category[0] || null,
                source: "heuristic",
              });
              return;
            }

            if (txn.date > (existing.last_charged || "")) {
              existing.last_charged = txn.date;
              existing.amount = txn.amount;
              existing.monthly_amount = txn.amount;
            }
          });

        subscriptions = Array.from(fallbackByMerchant.values());
      }

    const cashFlowTransactions = transactions.filter(isCashFlowRelevantTransaction);

    // Calculate category totals
    const categoryTotals: Record<string, number> = {};
    cashFlowTransactions.forEach((txn) => {
        if (txn.amount > 0) {
          // Positive amounts are expenses in Plaid
          const category = txn.category[0] || "Other";
          categoryTotals[category] =
            (categoryTotals[category] || 0) + txn.amount;
        }
      });

    // Calculate totals
    const totalSpending = cashFlowTransactions
      .filter((txn) => txn.amount > 0)
      .reduce((sum, txn) => sum + txn.amount, 0);

    const totalIncome = cashFlowTransactions
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
        transactionCount: cashFlowTransactions.length,
        startDate: start,
        endDate: end,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching transactions:", error);
    return handlePlaidError(error);
  }
}
