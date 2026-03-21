import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateSystemPrompt, UserContext } from "@/lib/noorAIPrompt";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase";

// Force dynamic rendering
export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_SIMPLE_MODEL = "google/gemini-2.0-flash-001";
const DEFAULT_COMPLEX_MODEL = "anthropic/claude-3.5-sonnet";

function isAiSupabaseReadEnabled(): boolean {
  return process.env.AI_SUPABASE_READ_ENABLED === "true";
}

function mapSupabaseContextToUserContext(data: {
  first_name?: string | null;
  last_name?: string | null;
  university?: string | null;
  institution_type?: string | null;
  has_ssn?: boolean | null;
  has_us_credit_history?: boolean | null;
  monthly_income?: number | null;
  campus_side?: string | null;
  expected_monthly_spending?: number | null;
}): Partial<UserContext> {
  return {
    firstName: data.first_name ?? undefined,
    lastName: data.last_name ?? undefined,
    university: data.university ?? undefined,
    institutionType: data.institution_type ?? undefined,
    hasSSN: data.has_ssn ?? undefined,
    hasCreditHistory: data.has_us_credit_history ?? undefined,
    monthlyIncome: data.monthly_income ?? undefined,
    campusSide: data.campus_side ?? undefined,
    monthlySpending: data.expected_monthly_spending ?? undefined,
  };
}

async function loadReadOnlyUserContextFromSupabase(
  userId: string
): Promise<Partial<UserContext>> {
  if (!isAiSupabaseReadEnabled() || !isSupabaseAdminConfigured()) {
    return {};
  }

  const supabaseAdmin = createAdminClient();

  const [{ data: userRow }, { data: surveyRow }] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("first_name,last_name")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("survey_responses")
      .select(
        "university,institution_type,has_ssn,has_us_credit_history,monthly_income,campus_side,expected_monthly_spending"
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return mapSupabaseContextToUserContext({
    first_name: userRow?.first_name,
    last_name: userRow?.last_name,
    university: surveyRow?.university,
    institution_type: surveyRow?.institution_type,
    has_ssn: surveyRow?.has_ssn,
    has_us_credit_history: surveyRow?.has_us_credit_history,
    monthly_income: surveyRow?.monthly_income,
    campus_side: surveyRow?.campus_side,
    expected_monthly_spending: surveyRow?.expected_monthly_spending,
  });
}

function normalizeOpenRouterModelId(model: string): string {
  const trimmed = model.trim();

  if (trimmed === "gemini-2.0-flash") {
    return "google/gemini-2.0-flash-001";
  }

  if (trimmed === "gemini-2.0-flash-lite") {
    return "google/gemini-2.0-flash-lite-001";
  }

  return trimmed;
}

function hasOpenRouterKey(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return !!key && key.trim() !== "";
}

// Initialize Anthropic client only if API key exists (used when OpenRouter not set)
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return new Anthropic({ apiKey });
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface OpenRouterResult {
  ok: boolean;
  status: number;
  message?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: string;
  model: string;
}

interface PlaidAccountSummary {
  type?: string;
  name?: string;
  current_balance?: number;
  available_balance?: number | null;
  iso_currency_code?: string;
}

interface PlaidTransactionSummary {
  amount: number;
  date: string;
  category?: string[];
  merchant_name?: string | null;
  name?: string;
}

interface FinancialSnapshot {
  balanceSummary: string;
  monthlySpendingEstimate: number;
  monthlyIncomeEstimate: number;
  netMonthlyEstimate: number;
  monthlySubscriptionEstimate: number;
  diningMonthlyEstimate: number;
  topSpendingCategory: string;
  incomeRegularityScore: number;
  riskLevel: "Low" | "Medium" | "High";
  safeBuffer: number;
  currency: string;
}

function getLastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].content || "";
    }
  }
  return "";
}

function isBalanceQuestion(message: string): boolean {
  const normalized = message.toLowerCase();

  const signals = [
    "balance",
    "my balance",
    "how much do i have",
    "how much money",
    "available balance",
    "current balance",
    "account balance",
    "checking balance",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

function isFinancialPlanningQuestion(message: string): boolean {
  const normalized = message.toLowerCase();

  const signals = [
    "can i afford",
    "should i buy",
    "on track",
    "broke",
    "save more",
    "what do i do",
    "spending cap",
    "budget",
    "subscription",
    "recurring",
    "cash flow",
    "payday",
    "rent due",
    "tax refund",
    "unexpected expense",
  ];

  return signals.some((signal) => normalized.includes(signal));
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function buildBalanceSummary(accounts: PlaidAccountSummary[]): string | null {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  const checkingAccount =
    accounts.find((account) => account.type === "checking") || accounts[0];

  if (typeof checkingAccount.current_balance !== "number") {
    return null;
  }

  const currency = checkingAccount.iso_currency_code || "USD";
  const available =
    typeof checkingAccount.available_balance === "number"
      ? checkingAccount.available_balance
      : checkingAccount.current_balance;

  return `Your checking available balance is ${formatAmount(
    available,
    currency
  )} and current balance is ${formatAmount(
    checkingAccount.current_balance,
    currency
  )}.`;
}

function calculateIncomeRegularityScore(
  transactions: PlaidTransactionSummary[]
): number {
  const incomeTxns = transactions.filter((txn) => txn.amount < 0);
  if (incomeTxns.length < 2) return 50;

  const amounts = incomeTxns.map((txn) => Math.abs(txn.amount));
  const mean = amounts.reduce((sum, n) => sum + n, 0) / amounts.length;
  if (mean <= 0) return 50;

  const variance =
    amounts.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  const coeffVar = stdDev / mean;

  const score = Math.max(0, Math.min(100, Math.round((1 - coeffVar) * 100)));
  return score;
}

function detectTopSpendingCategory(
  categoryTotals: Record<string, number>
): string {
  const entries = Object.entries(categoryTotals || {});
  if (entries.length === 0) return "Unknown";

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function calculateRiskLevel(
  availableBalance: number,
  monthlySpendingEstimate: number
): { riskLevel: "Low" | "Medium" | "High"; safeBuffer: number } {
  const safeBuffer = Math.max(300, monthlySpendingEstimate * 0.25);

  if (availableBalance < safeBuffer) {
    return { riskLevel: "High", safeBuffer };
  }

  if (availableBalance < safeBuffer * 2) {
    return { riskLevel: "Medium", safeBuffer };
  }

  return { riskLevel: "Low", safeBuffer };
}

function buildFinancialSnapshot(
  accounts: PlaidAccountSummary[],
  transactions: PlaidTransactionSummary[],
  subscriptions: Array<{ amount?: number }>,
  categoryTotals: Record<string, number>,
  summary: {
    totalSpending?: number;
    totalIncome?: number;
    startDate?: string;
    endDate?: string;
  }
): FinancialSnapshot | null {
  const checkingAccount =
    accounts.find((account) => account.type === "checking") || accounts[0];

  if (!checkingAccount || typeof checkingAccount.current_balance !== "number") {
    return null;
  }

  const currency = checkingAccount.iso_currency_code || "USD";
  const availableBalance =
    typeof checkingAccount.available_balance === "number"
      ? checkingAccount.available_balance
      : checkingAccount.current_balance;

  const startDate = summary.startDate
    ? new Date(summary.startDate)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = summary.endDate ? new Date(summary.endDate) : new Date();
  const rangeDays = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  );

  const totalSpending = Math.max(0, summary.totalSpending || 0);
  const totalIncome = Math.max(0, summary.totalIncome || 0);
  const monthlySpendingEstimate = (totalSpending / rangeDays) * 30;
  const monthlyIncomeEstimate = (totalIncome / rangeDays) * 30;
  const netMonthlyEstimate = monthlyIncomeEstimate - monthlySpendingEstimate;

  const totalSubscriptionSpend = subscriptions.reduce(
    (sum, sub) => sum + Math.max(0, sub.amount || 0),
    0
  );
  const monthlySubscriptionEstimate = (totalSubscriptionSpend / rangeDays) * 30;

  const diningSpend = transactions
    .filter((txn) => txn.amount > 0)
    .filter((txn) => {
      const categories = txn.category || [];
      return categories.some((cat) => /food|dining|restaurant/i.test(cat));
    })
    .reduce((sum, txn) => sum + txn.amount, 0);
  const diningMonthlyEstimate = (diningSpend / rangeDays) * 30;

  const topSpendingCategory = detectTopSpendingCategory(categoryTotals);
  const incomeRegularityScore = calculateIncomeRegularityScore(transactions);
  const { riskLevel, safeBuffer } = calculateRiskLevel(
    availableBalance,
    monthlySpendingEstimate
  );

  return {
    balanceSummary: `Your checking available balance is ${formatAmount(
      availableBalance,
      currency
    )} and current balance is ${formatAmount(
      checkingAccount.current_balance,
      currency
    )}.`,
    monthlySpendingEstimate,
    monthlyIncomeEstimate,
    netMonthlyEstimate,
    monthlySubscriptionEstimate,
    diningMonthlyEstimate,
    topSpendingCategory,
    incomeRegularityScore,
    riskLevel,
    safeBuffer,
    currency,
  };
}

async function fetchBalanceSummaryFromPlaidRoute(
  request: NextRequest,
  userId: string
): Promise<string | null> {
  try {
    const accountsUrl = new URL("/api/plaid/accounts", request.url);
    const response = await fetch(accountsUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({ userId }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return buildBalanceSummary(data?.accounts || []);
  } catch {
    return null;
  }
}

async function fetchFinancialSnapshotFromPlaidRoutes(
  request: NextRequest,
  userId: string
): Promise<FinancialSnapshot | null> {
  try {
    const accountsUrl = new URL("/api/plaid/accounts", request.url);
    const transactionsUrl = new URL("/api/plaid/transactions", request.url);

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const [accountsRes, transactionsRes] = await Promise.all([
      fetch(accountsUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") || "",
        },
        body: JSON.stringify({ userId }),
        cache: "no-store",
      }),
      fetch(transactionsUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") || "",
        },
        body: JSON.stringify({ userId, startDate, endDate }),
        cache: "no-store",
      }),
    ]);

    if (!accountsRes.ok || !transactionsRes.ok) {
      return null;
    }

    const accountsData = await accountsRes.json();
    const transactionsData = await transactionsRes.json();

    return buildFinancialSnapshot(
      accountsData?.accounts || [],
      transactionsData?.transactions || [],
      transactionsData?.subscriptions || [],
      transactionsData?.categoryTotals || {},
      transactionsData?.summary || {}
    );
  } catch {
    return null;
  }
}

function isComplexPrompt(message: string): boolean {
  const normalized = message.toLowerCase();

  if (message.length > 350) {
    return true;
  }

  const complexitySignals = [
    "compare",
    "tradeoff",
    "step by step",
    "tax",
    "visa",
    "opt",
    "cpt",
    "budget plan",
    "scenario",
    "strategy",
    "explain in detail",
    "edge case",
    "regulation",
  ];

  return complexitySignals.some((signal) => normalized.includes(signal));
}

function dedupeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const model of models) {
    const trimmed = normalizeOpenRouterModelId(model);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }

  return unique;
}

function selectOpenRouterModels(messages: ChatMessage[]): string[] {
  const configuredPrimary = process.env.OPENROUTER_MODEL?.trim();
  const configuredFallback = process.env.OPENROUTER_FALLBACK_MODEL?.trim();

  if (configuredPrimary) {
    return dedupeModels([
      configuredPrimary,
      configuredFallback || DEFAULT_COMPLEX_MODEL,
    ]);
  }

  const lastUserMessage = getLastUserMessage(messages);
  const complex = isComplexPrompt(lastUserMessage);

  const simpleModel =
    process.env.OPENROUTER_SIMPLE_MODEL?.trim() || DEFAULT_SIMPLE_MODEL;
  const complexModel =
    process.env.OPENROUTER_COMPLEX_MODEL?.trim() || DEFAULT_COMPLEX_MODEL;

  const primaryModel = complex ? complexModel : simpleModel;
  const fallbackModel =
    configuredFallback || (complex ? simpleModel : complexModel);

  return dedupeModels([primaryModel, fallbackModel]);
}

async function callOpenRouter(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<OpenRouterResult> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errMsg =
      data?.error?.message || data?.message || "OpenRouter request failed";
    return {
      ok: false,
      status: res.status,
      error: errMsg,
      model,
    };
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const assistantContent = typeof rawContent === "string" ? rawContent : "";
  const usage = data?.usage;

  return {
    ok: true,
    status: 200,
    model,
    message: assistantContent || "Sorry, I could not generate a response.",
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens ?? usage.input_tokens,
          output_tokens: usage.completion_tokens ?? usage.output_tokens,
        }
      : undefined,
  };
}

// Demo mode responses when no API key is configured
const DEMO_RESPONSES: Record<string, string> = {
  // Greetings
  hello:
    "Hello! I am Noor AI. I can help with banking, visa questions, housing, and more for international students in the US.",
  hi: "Hello! I am Noor AI. How can I help you today?",

  // Banking
  no_ssn_account: `You can open a US bank account without an SSN.\n\n**Recommended banks:**\n1. **Chase Bank** - Often possible in branch with passport and I-20\n2. **Bank of America** - Common choice for international students\n3. **Wells Fargo** - Widely available and student-friendly\n\n**Documents you may need:**\n- Passport\n- I-20 or DS-2019\n- School admission or enrollment proof\n- US address proof (such as a lease)\n\nCheck the Banking section in Noor for personalized options.`,

  bank: `Here are the best banks for international students! 🏦

**Top Recommendations:**
1. **Chase Bank** - Can open with passport + I-20
2. **Bank of America** - International student friendly
3. **Wells Fargo** - No SSN required in-branch

Check out our Banking section for personalized recommendations!`,

  // Credit cards
  credit_card: `You can start building credit even without a US credit history.\n\n**Secured cards (deposit required):**\n- Discover it Secured\n- Capital One Secured\n\n**Student cards:**\n- Discover it Student\n- Journey Student Rewards\n\n**Without SSN:**\n- Some cards can be applied for using ITIN depending on issuer policy\n\nSee the Funding section for details and next steps.`,

  // Visa
  visa: `Key F-1 reminders:\n\n**Important rules:**\n- Maintain full-time enrollment\n- Off-campus work usually requires CPT or OPT authorization\n- Make sure your I-20 travel signature is valid before travel\n\n**Work options:**\n- CPT: Internship or co-op during studies\n- OPT: Up to 12 months after graduation (plus STEM extension if eligible)\n\nUse the Visa section to track your timeline.`,

  // Housing
  housing: `Tips for finding housing in the US:\n\n**Suggested order:**\n1. Campus housing for your first term\n2. Nearby apartments after you settle in\n3. Roommates to reduce costs\n\n**Checklist:**\n- Security deposit amount\n- Whether utilities are included\n- Commute distance to campus\n- Neighborhood safety\n\nUse the Housing section to explore options near your school.`,

  // Default
  default: `Hello! I am Noor AI.\n\nI can help with:\n- Bank account setup\n- Credit card choices\n- Visa and status questions\n- Housing decisions\n- Scholarship and budgeting guidance\n\nAsk anything.\n\n---\n*You are currently in demo mode. For richer responses, configure an API provider key.*`,
};

function getDemoResponse(message: string): string {
  const lowerMessage = message.toLowerCase();

  // Check for keyword matches
  if (lowerMessage === "hi" || lowerMessage === "hello") {
    return DEMO_RESPONSES.hello;
  }
  if (
    lowerMessage.includes("ssn") &&
    (lowerMessage.includes("account") || lowerMessage.includes("bank"))
  ) {
    return DEMO_RESPONSES.no_ssn_account;
  }
  if (lowerMessage.includes("bank") || lowerMessage.includes("account")) {
    return DEMO_RESPONSES["bank"];
  }
  if (
    lowerMessage.includes("credit") ||
    lowerMessage.includes("card") ||
    lowerMessage.includes("fico")
  ) {
    return DEMO_RESPONSES.credit_card;
  }
  if (
    lowerMessage.includes("visa") ||
    lowerMessage.includes("f-1") ||
    lowerMessage.includes("opt") ||
    lowerMessage.includes("cpt")
  ) {
    return DEMO_RESPONSES.visa;
  }
  if (
    lowerMessage.includes("house") ||
    lowerMessage.includes("housing") ||
    lowerMessage.includes("rent") ||
    lowerMessage.includes("apartment")
  ) {
    return DEMO_RESPONSES.housing;
  }

  return DEMO_RESPONSES.default;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, userContext, userId } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    let mergedUserContext: UserContext = userContext || {};

    if (typeof userId === "string" && userId.trim().length > 0) {
      const dbContext = await loadReadOnlyUserContextFromSupabase(
        userId.trim()
      );
      mergedUserContext = {
        ...dbContext,
        ...(userContext || {}),
      };
    }

    const formattedMessages = messages.map((msg: ChatMessage) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));
    const lastUserMessageText = getLastUserMessage(formattedMessages);
    const wantsBalance = isBalanceQuestion(lastUserMessageText);
    const wantsFinancialAnalysis =
      isFinancialPlanningQuestion(lastUserMessageText);

    let systemPrompt = generateSystemPrompt(mergedUserContext);

    if (
      wantsBalance &&
      typeof userId === "string" &&
      userId.trim().length > 0
    ) {
      const balanceSummary = await fetchBalanceSummaryFromPlaidRoute(
        request,
        userId.trim()
      );

      if (balanceSummary) {
        systemPrompt += `\n\n## Verified Balance Snapshot\n${balanceSummary}\n\nIf the user asks about their balance, respond in one sentence using exactly this verified snapshot. Do not change the amounts and do not add other accounts unless asked.`;
      } else {
        systemPrompt +=
          "\n\nIf the user asks about their balance and no verified snapshot is available, explain that a bank connection is required and suggest reconnecting Plaid in Noor.";
      }
    }

    if (
      wantsFinancialAnalysis &&
      typeof userId === "string" &&
      userId.trim().length > 0
    ) {
      const snapshot = await fetchFinancialSnapshotFromPlaidRoutes(
        request,
        userId.trim()
      );

      if (snapshot) {
        systemPrompt += `\n\n## Verified Financial Snapshot\n- ${
          snapshot.balanceSummary
        }\n- Estimated monthly income: ${formatAmount(
          snapshot.monthlyIncomeEstimate,
          snapshot.currency
        )}\n- Estimated monthly spending: ${formatAmount(
          snapshot.monthlySpendingEstimate,
          snapshot.currency
        )}\n- Estimated net monthly cash flow: ${formatAmount(
          snapshot.netMonthlyEstimate,
          snapshot.currency
        )}\n- Estimated monthly subscription cost: ${formatAmount(
          snapshot.monthlySubscriptionEstimate,
          snapshot.currency
        )}\n- Estimated monthly dining spend: ${formatAmount(
          snapshot.diningMonthlyEstimate,
          snapshot.currency
        )}\n- Top spending category: ${
          snapshot.topSpendingCategory
        }\n- Income regularity score (0-100): ${
          snapshot.incomeRegularityScore
        }\n- Baseline risk level: ${
          snapshot.riskLevel
        }\n- Safe buffer target: ${formatAmount(
          snapshot.safeBuffer,
          snapshot.currency
        )}\n\n## Required Output Format For Money Decisions\nWhen the user asks affordability, budgeting, subscriptions, savings progress, or purchase timing:\n1) Start with one empathy sentence if the user sounds stressed.\n2) Show a compact math line using real numbers from snapshot + user-stated obligations (rent, bills, planned purchase).\n3) Provide Risk Level: Low, Medium, or High.\n4) Provide one clear recommendation: go, wait, or capped spend.\n5) Provide one practical alternative if risk is Medium/High.\n6) If data is incomplete, ask exactly one follow-up question needed for better precision.\n\nDo not give generic advice without numbers.`;
      } else {
        systemPrompt +=
          "\n\nIf the user asks affordability or planning questions and verified banking data is unavailable, state that you need a connected bank account and then provide a conservative estimate framework.";
      }
    }

    // 1) Prefer OpenRouter when OPENROUTER_API_KEY is set
    if (hasOpenRouterKey()) {
      const openRouterMessages = [
        { role: "system" as const, content: systemPrompt },
        ...formattedMessages,
      ];

      const modelsToTry = selectOpenRouterModels(formattedMessages);
      let lastFailure: OpenRouterResult | null = null;

      for (const model of modelsToTry) {
        const result = await callOpenRouter(model, openRouterMessages);

        if (result.ok) {
          return NextResponse.json({
            success: true,
            message: result.message,
            model: result.model,
            usage: result.usage,
          });
        }

        // Auth errors should fail fast rather than retrying other models.
        if (result.status === 401) {
          return NextResponse.json(
            { error: "Invalid OpenRouter API key", demo_available: true },
            { status: 401 }
          );
        }

        lastFailure = result;
      }

      if (lastFailure?.status === 429) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: lastFailure?.error || "OpenRouter request failed" },
        { status: lastFailure?.status || 500 }
      );
    }

    // 2) Fallback to Anthropic if ANTHROPIC_API_KEY is set
    const anthropic = getAnthropicClient();
    if (anthropic) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: systemPrompt,
        messages: formattedMessages,
      });

      const assistantMessage =
        response.content[0].type === "text" ? response.content[0].text : "";

      return NextResponse.json({
        success: true,
        message: assistantMessage,
        model: "claude-sonnet-4-5-20250929",
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      });
    }

    // 3) Demo mode when no API key is configured
    const lastUserMessage = messages[messages.length - 1];
    const demoResponse = getDemoResponse(lastUserMessage?.content || "");
    await new Promise((resolve) => setTimeout(resolve, 500));

    return NextResponse.json({
      success: true,
      message: demoResponse,
      demo_mode: true,
      model: "demo-mode",
    });
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        return NextResponse.json(
          { error: "Invalid API key", demo_available: true },
          { status: 401 }
        );
      }
      if (error.status === 429) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to get response from AI" },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch chat history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ messages: [] });
    }

    // Return empty history for now (Supabase integration optional)
    return NextResponse.json({
      success: true,
      messages: [],
    });
  } catch (error) {
    console.error("Error fetching chat history:", error);
    return NextResponse.json({ messages: [] });
  }
}
