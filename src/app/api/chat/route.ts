import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateSystemPrompt, UserContext } from "@/lib/noorAIPrompt";
import {
  createAdminClient,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { getAuthenticatedUserIdFromRequest } from "@/lib/apiAuth";
import {
  asPlainObject,
  readFiniteNumber,
  readRequestJson,
} from "@/lib/requestJson";
import {
  buildJsonAuthorizedHeaders,
  extrasFromAuthorizationValue,
} from "@/lib/supabaseAuthHeaders";
import {
  isAiMemoryEnabled,
  getOrCreateActiveSession,
  getActiveSession,
  buildMemoryContext,
  formatMemoryForPrompt,
  saveMessages,
  getSessionMessages,
  type DbChatMessage,
  type ChatSession,
} from "@/lib/aiMemory";

// Force dynamic rendering
export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_SIMPLE_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_COMPLEX_MODEL = "anthropic/claude-sonnet-4.6";

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

  // Normalize shorthand aliases to current OpenRouter model IDs.
  const ALIASES: Record<string, string> = {
    "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
    "claude-haiku-4.5": "anthropic/claude-haiku-4.5",
    // Legacy aliases kept for backward compat — redirect to current equivalents.
    "gemini-2.0-flash": "google/gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite": "google/gemini-2.5-flash-lite",
  };

  return ALIASES[trimmed] ?? trimmed;
}

function resolveOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.trim() === "") {
    return null;
  }
  return key.trim();
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

function parseChatMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const o = asPlainObject(item);
    if (o.role !== "user" && o.role !== "assistant") {
      return null;
    }
    if (typeof o.content !== "string") {
      return null;
    }
    out.push({ role: o.role, content: o.content });
  }
  return out.length > 0 ? out : null;
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

interface PlaidSubscriptionSummary {
  id?: string;
  name?: string;
  amount?: number;
  monthly_amount?: number;
  iso_currency_code?: string;
  frequency?: "weekly" | "monthly" | "yearly" | "unknown" | string;
  last_charged?: string | null;
  next_charge?: string | null;
}

interface FinancialSnapshot {
  balanceSummary: string;
  monthlySpendingEstimate: number;
  monthlyIncomeEstimate: number;
  netMonthlyEstimate: number;
  monthlySubscriptionEstimate: number;
  subscriptions: Array<{
    name: string;
    monthlyAmount: number;
    amount: number;
    currency: string;
    frequency: string;
    lastCharged: string | null;
    nextCharge: string | null;
  }>;
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

function isSimpleGreetingOrSmallTalk(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[!.,?]+/g, "")
    .replace(/\s+/g, " ");

  if (!normalized) return false;

  const exactGreetings = new Set([
    "hi",
    "hello",
    "hey",
    "hiya",
    "howdy",
    "yo",
    "sup",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "how are you doing",
    "whats up",
    "what's up",
    "thanks",
    "thank you",
    "ok",
    "okay",
  ]);

  if (exactGreetings.has(normalized)) return true;

  if (normalized.length <= 20) {
    return /^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(normalized);
  }

  return false;
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

function isSubscriptionQuestion(message: string): boolean {
  const normalized = message.toLowerCase();

  const signals = [
    "subscription",
    "subscriptions",
    "recurring",
    "what am i paying",
    "what are my bills",
    "monthly charges",
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
  subscriptions: PlaidSubscriptionSummary[],
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

  const normalizedSubscriptions = subscriptions
    .map((sub, index) => {
      const recurringMonthly =
        typeof sub.monthly_amount === "number" &&
        Number.isFinite(sub.monthly_amount)
          ? sub.monthly_amount
          : undefined;
      const fallbackAmount =
        typeof sub.amount === "number" && Number.isFinite(sub.amount)
          ? sub.amount
          : 0;
      const monthlyAmount = Math.max(0, recurringMonthly ?? fallbackAmount);

      return {
        name: sub.name?.trim() || `Subscription ${index + 1}`,
        monthlyAmount,
        amount: Math.max(0, fallbackAmount),
        currency: sub.iso_currency_code || currency,
        frequency: sub.frequency || "unknown",
        lastCharged: sub.last_charged || null,
        nextCharge: sub.next_charge || null,
      };
    })
    .filter((sub) => sub.monthlyAmount > 0)
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount);

  const monthlySubscriptionEstimate = normalizedSubscriptions.reduce(
    (sum, sub) => sum + sub.monthlyAmount,
    0
  );

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
    subscriptions: normalizedSubscriptions,
    diningMonthlyEstimate,
    topSpendingCategory,
    incomeRegularityScore,
    riskLevel,
    safeBuffer,
    currency,
  };
}

async function fetchBalanceSummaryFromPlaidRoute(
  request: NextRequest
): Promise<string | null> {
  try {
    const plaidHeaders = buildJsonAuthorizedHeaders(
      extrasFromAuthorizationValue(request.headers.get("authorization"))
    );
    const accountsUrl = new URL("/api/plaid/accounts", request.url);
    const response = await fetch(accountsUrl.toString(), {
      method: "POST",
      headers: plaidHeaders,
      body: JSON.stringify({}),
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
  request: NextRequest
): Promise<FinancialSnapshot | null> {
  try {
    const accountsUrl = new URL("/api/plaid/accounts", request.url);
    const transactionsUrl = new URL("/api/plaid/transactions", request.url);

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const plaidHeaders = buildJsonAuthorizedHeaders(
      extrasFromAuthorizationValue(request.headers.get("authorization"))
    );

    const [accountsRes, transactionsRes] = await Promise.all([
      fetch(accountsUrl.toString(), {
        method: "POST",
        headers: plaidHeaders,
        body: JSON.stringify({}),
        cache: "no-store",
      }),
      fetch(transactionsUrl.toString(), {
        method: "POST",
        headers: plaidHeaders,
        body: JSON.stringify({ startDate, endDate }),
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
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<OpenRouterResult> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
    }),
  });

  const data = asPlainObject(await res.json().catch(() => ({})));

  if (!res.ok) {
    const errNested = data.error;
    const errObj =
      typeof errNested === "object" && errNested !== null
        ? asPlainObject(errNested)
        : {};
    const errMsg =
      (typeof errObj.message === "string" ? errObj.message : undefined) ||
      (typeof data.message === "string" ? data.message : undefined) ||
      "OpenRouter request failed";
    return {
      ok: false,
      status: res.status,
      error: errMsg,
      model,
    };
  }

  const choices = data.choices;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0
      ? asPlainObject(choices[0])
      : {};
  const messageObj = asPlainObject(firstChoice.message);
  const rawContent = messageObj.content;
  const assistantContent = typeof rawContent === "string" ? rawContent : "";
  const usageRaw = data.usage;
  const usageObj =
    typeof usageRaw === "object" && usageRaw !== null
      ? asPlainObject(usageRaw)
      : null;

  return {
    ok: true,
    status: 200,
    model,
    message: assistantContent || "Sorry, I could not generate a response.",
    usage: usageObj
      ? {
          input_tokens:
            readFiniteNumber(usageObj, "prompt_tokens") ??
            readFiniteNumber(usageObj, "input_tokens"),
          output_tokens:
            readFiniteNumber(usageObj, "completion_tokens") ??
            readFiniteNumber(usageObj, "output_tokens"),
        }
      : undefined,
  };
}

/**
 * Identifies errors that are temporary and likely to succeed on retry.
 *
 * Retryable (returns true):
 *   - Postgres SQLSTATE class 08 (Connection Exception)
 *   - Postgres SQLSTATE class 53 (Insufficient Resources)
 *   - Postgres SQLSTATE class 57 (Operator Intervention)
 *   - Network errors: ETIMEDOUT, ECONNRESET
 *   - HTTP gateway errors: 502, 503, 504
 *
 * NOT retryable: 23xxx constraint violations, auth errors, 4xx HTTP.
 *
 * Checks both error itself and Error.cause (one level) to support
 * wrapDbError-style wrapped errors.
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidates: Array<{ code?: string; message?: string; status?: number }> =
    [error as { code?: string; message?: string; status?: number }];
  if (error instanceof Error && error.cause && typeof error.cause === "object") {
    candidates.push(
      error.cause as { code?: string; message?: string; status?: number }
    );
  }

  for (const c of candidates) {
    if (c.code && /^(08|53|57)/.test(c.code)) return true;
    if (c.code === "ETIMEDOUT" || c.code === "ECONNRESET") return true;
    if (typeof c.status === "number" && c.status >= 502 && c.status <= 504) {
      return true;
    }
    if (typeof c.message === "string") {
      if (
        c.message.includes("fetch failed") ||
        c.message.includes("network") ||
        c.message.includes("timeout")
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Runs an async operation with one retry on transient failures.
 * Adds ~250ms delay before retry.
 *
 * ⚠️ DO NOT use this around non-idempotent writes such as saveMessages.
 * The first call may have committed before timeout; retry would duplicate.
 * Use only for reads and idempotent writes (e.g., getOrCreateActiveSession).
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableError(error)) throw error;

    console.warn(
      `[retry] ${context}: transient error, retrying once:`,
      error instanceof Error ? error.message : error
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    try {
      const result = await operation();
      console.info(`[retry] ${context}: recovered after retry`);
      return result;
    } catch (retryError) {
      console.error(
        `[retry] ${context}: failed after retry:`,
        retryError instanceof Error ? retryError.message : retryError
      );
      throw retryError;
    }
  }
}

interface ClientChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
}

function toClientChatMessage(row: DbChatMessage): ClientChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.created_at,
    model: row.model ?? undefined,
  };
}

/**
 * Persists a user+assistant turn to chat history if AI memory is enabled
 * and an active session exists.
 *
 * Skip vs throw policy:
 *   - Memory disabled OR no active session → silent skip (no-op)
 *   - Memory enabled AND session exists AND content empty → throw
 *   - Memory enabled AND session exists AND content non-empty → saveMessages
 *
 * The "empty content throws" rule prevents silent "200 OK but DB has 0 turns"
 * which would break the data-consistency guarantee.
 *
 * Does NOT retry (saveMessages is non-idempotent). Callers should catch
 * and translate to an HTTP error response.
 *
 * @throws Error when persistence is expected but content is empty, or
 *   when the underlying saveMessages call fails.
 */
async function persistTurnIfEnabled(params: {
  activeSession: ChatSession | null;
  authUserId: string;
  userContent: string;
  assistantContent: string;
  assistantModel: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  if (!isAiMemoryEnabled()) return;
  if (!params.activeSession) return;

  if (!params.userContent.trim() || !params.assistantContent.trim()) {
    throw new Error(
      "persistTurnIfEnabled: cannot persist empty user or assistant content " +
        "(memory is enabled but content is missing)"
    );
  }

  await saveMessages(params.activeSession.id, params.authUserId, {
    userContent: params.userContent,
    assistantContent: params.assistantContent,
    assistantModel: params.assistantModel,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  });
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await getAuthenticatedUserIdFromRequest(request);
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let activeSession: ChatSession | null = null;
    let memoryBlock = "";

    const rawBody = await readRequestJson(request);
    const bodyObj = asPlainObject(rawBody);
    const parsedMessages = parseChatMessages(bodyObj.messages);
    if (!parsedMessages) {
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    const dbContext = await loadReadOnlyUserContextFromSupabase(authUserId);

    if (isAiMemoryEnabled()) {
      try {
        activeSession = await withRetry(
          () => getOrCreateActiveSession(authUserId),
          "getOrCreateActiveSession"
        );

        const memoryContext = await withRetry(
          () => buildMemoryContext(authUserId, { activeSession }),
          "buildMemoryContext"
        );

        memoryBlock = formatMemoryForPrompt(memoryContext);
      } catch (error) {
        console.error("AI memory load failed:", error);
        return NextResponse.json(
          {
            error: "Memory system temporarily unavailable. Please try again.",
            code: "MEMORY_LOAD_FAILED",
          },
          { status: 503 }
        );
      }
    }

    // SECURITY (prompt injection): The client-supplied `userContext` in the
    // request body was previously spread over `dbContext`, letting the client
    // override server-side profile values. Those values are interpolated raw
    // (no escaping) into the system prompt under "## Current User Context" via
    // generateSystemPrompt, so a crafted field (e.g. firstName containing
    // newlines + markdown headers) could inject attacker-controlled text into
    // the model's instruction context. The client only ever re-sends the same
    // 9 profile fields the server already reads from the DB (users +
    // survey_responses), so the body value is redundant. We ignore it entirely
    // and trust only the server-side DB read. Do NOT reintroduce a client
    // patch here without per-field whitelisting + sanitization and a real need.
    const mergedUserContext: UserContext = dbContext;

    const formattedMessages = parsedMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
    const lastUserMessageText = getLastUserMessage(formattedMessages);
    const isGreeting = isSimpleGreetingOrSmallTalk(lastUserMessageText);
    const wantsBalance =
      !isGreeting && isBalanceQuestion(lastUserMessageText);
    const wantsFinancialAnalysis =
      !isGreeting && isFinancialPlanningQuestion(lastUserMessageText);
    const wantsSubscriptionDetails =
      !isGreeting && isSubscriptionQuestion(lastUserMessageText);

    let systemPrompt = generateSystemPrompt(mergedUserContext);
    systemPrompt += memoryBlock;

    if (isGreeting) {
      systemPrompt +=
        "\n\n## Current Turn: Simple Greeting or Small Talk\nThe user's latest message is only a greeting or brief small talk. Reply in 1-2 short, friendly sentences. Do NOT mention their income, spending, budget, bank balance, visa, or profile details unless they explicitly asked.";
    }

    if (wantsBalance) {
      const balanceSummary = await fetchBalanceSummaryFromPlaidRoute(request);

      if (balanceSummary) {
        systemPrompt += `\n\n## Verified Balance Snapshot\n${balanceSummary}\n\nIf the user asks about their balance, respond in one sentence using exactly this verified snapshot. Do not change the amounts and do not add other accounts unless asked.`;
      } else {
        systemPrompt +=
          "\n\nIf the user asks about their balance and no verified snapshot is available, explain that a bank connection is required and suggest reconnecting Plaid in Noor.";
      }
    }

    if (wantsFinancialAnalysis) {
      const snapshot = await fetchFinancialSnapshotFromPlaidRoutes(request);

      if (snapshot) {
        const subscriptionBreakdown =
          snapshot.subscriptions.length > 0
            ? snapshot.subscriptions
                .slice(0, 8)
                .map(
                  (sub) =>
                    `  - ${sub.name}: ${formatAmount(
                      sub.monthlyAmount,
                      sub.currency
                    )}/mo (${sub.frequency})`
                )
                .join("\n")
            : "  - No active recurring subscriptions detected in the selected date range.";

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
        )}\n- Active subscriptions (monthly):\n${subscriptionBreakdown}\n- Estimated monthly dining spend: ${formatAmount(
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

        if (wantsSubscriptionDetails) {
          systemPrompt +=
            "\n\nIf the user asks for subscriptions, list each verified subscription with monthly amount first, then give one concise total monthly subscription cost line. Keep the answer plain and avoid generic budget advice unless requested.";
        }
      } else {
        systemPrompt +=
          "\n\nIf the user asks affordability or planning questions and verified banking data is unavailable, state that you need a connected bank account and then provide a conservative estimate framework.";
      }
    }

    // 1) Prefer OpenRouter when OPENROUTER_API_KEY is set
    const openRouterApiKey = resolveOpenRouterApiKey();
    if (openRouterApiKey) {
      const openRouterMessages = [
        { role: "system" as const, content: systemPrompt },
        ...formattedMessages,
      ];

      const modelsToTry = selectOpenRouterModels(formattedMessages);
      let lastFailure: OpenRouterResult | null = null;

      for (const model of modelsToTry) {
        const result = await callOpenRouter(
          openRouterApiKey,
          model,
          openRouterMessages
        );

        if (result.ok) {
          try {
            await persistTurnIfEnabled({
              activeSession,
              authUserId,
              userContent: lastUserMessageText,
              assistantContent: result.message ?? "",
              assistantModel: result.model,
              inputTokens: result.usage?.input_tokens,
              outputTokens: result.usage?.output_tokens,
            });
          } catch (error) {
            console.error("Failed to save messages (OpenRouter branch):", error);
            return NextResponse.json(
              {
                error:
                  "Could not save your conversation. Please try sending your message again.",
                code: "SAVE_FAILED",
              },
              { status: 500 }
            );
          }

          return NextResponse.json({
            success: true,
            message: result.message,
            model: result.model,
            sessionId: activeSession?.id ?? null,
            usage: result.usage,
          });
        }

        // Auth errors should fail fast rather than retrying other models.
        if (result.status === 401) {
          return NextResponse.json(
            { error: "Invalid OpenRouter API key" },
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

      try {
        await persistTurnIfEnabled({
          activeSession,
          authUserId,
          userContent: lastUserMessageText,
          assistantContent: assistantMessage,
          assistantModel: "claude-sonnet-4-5-20250929",
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        });
      } catch (error) {
        console.error("Failed to save messages (Anthropic branch):", error);
        return NextResponse.json(
          {
            error:
              "Could not save your conversation. Please try sending your message again.",
            code: "SAVE_FAILED",
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: assistantMessage,
        model: "claude-sonnet-4-5-20250929",
        sessionId: activeSession?.id ?? null,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      });
    }

    return NextResponse.json(
      {
        error:
          "AI provider is not configured. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY.",
      },
      { status: 503 }
    );
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
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
    const authUserId = await getAuthenticatedUserIdFromRequest(request);
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isAiMemoryEnabled()) {
      return NextResponse.json({ success: true, messages: [] });
    }

    try {
      const activeSession = await withRetry(
        () => getActiveSession(authUserId),
        "GET getActiveSession"
      );

      if (!activeSession) {
        return NextResponse.json({
          success: true,
          messages: [],
          sessionId: null,
        });
      }

      const dbMessages = await withRetry(
        () =>
          getSessionMessages(activeSession.id, authUserId, {
            limit: 50,
            order: "desc",
          }),
        "GET getSessionMessages"
      );

      const messages = dbMessages.reverse().map(toClientChatMessage);

      return NextResponse.json({
        success: true,
        messages,
        sessionId: activeSession.id,
      });
    } catch (memoryError) {
      console.error("AI memory load failed (GET):", memoryError);
      return NextResponse.json(
        {
          error: "Memory system temporarily unavailable. Please try again.",
          code: "MEMORY_LOAD_FAILED",
        },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error("Failed to fetch chat history:", error);
    return NextResponse.json(
      { error: "Failed to fetch chat history" },
      { status: 500 }
    );
  }
}
