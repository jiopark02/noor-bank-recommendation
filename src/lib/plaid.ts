import axios from "axios";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import { redactPlaidAxiosError } from "./plaidErrorRedaction";

// Plaid configuration
const configuration = new Configuration({
  basePath:
    PlaidEnvironments[
      (process.env.PLAID_ENV as keyof typeof PlaidEnvironments) || "sandbox"
    ],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID || "",
      "PLAID-SECRET": process.env.PLAID_SECRET || "",
    },
  },
});

// PLAID-SEC1: every Plaid call goes through this axios instance, whose only job
// is to strip credentials off rejected requests before they reach any caller.
//
// The Configuration above injects PLAID-CLIENT-ID / PLAID-SECRET as request
// headers, so an AxiosError carries them on `error.config.headers` and carries
// the user's access_token on `error.config.data`. Redacting here — inside the
// SDK's promise chain, before the rejection is handed to the caller — means
// every `catch` in the app receives an already-safe error, instead of the
// safety depending on each log site remembering to be careful.
//
// create() is deliberately called with NO config object: an empty create()
// inherits the global axios defaults, so timeout, transformRequest/Response and
// validateStatus stay exactly as they were when the SDK used the global axios.
const plaidHttp = axios.create();

// One response interceptor, error path only.
// - The success handler is the identity function: successful responses pass
//   through untouched, so response parsing is unchanged.
// - No request interceptor is registered, so header injection, body
//   serialization and URL assembly remain entirely the SDK's.
// - The failure handler ends in Promise.reject, preserving rejection semantics.
//   It must never swallow an error or convert it into a resolution.
plaidHttp.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(redactPlaidAxiosError(error))
);

/**
 * The single Plaid client for the whole app.
 *
 * ⚠️ If you ever construct a second PlaidApi, it MUST receive `plaidHttp` as
 * the third argument as well. The redaction guarantee above is a property of
 * THIS instance, not of the SDK: a client built as `new PlaidApi(configuration)`
 * falls back to the global axios, has no interceptor, and will leak the secret
 * and the user's access_token into the logs on its first failed call.
 *
 * ⚠️ The third constructor parameter is plaid's public API
 * (`BaseAPI(configuration?, basePath?, axios?)`) and every generated method
 * dispatches through `this.axios`. Re-verify that signature when upgrading
 * `plaid` across a major version — if the injection point moves, the
 * interceptor silently stops running and the leak returns.
 *
 * `undefined` for basePath keeps the SDK default, and `configuration.basePath`
 * (derived from PLAID_ENV above) still wins, because the generated request
 * builder evaluates `configuration?.basePath || basePath`.
 */
export const plaidClient = new PlaidApi(configuration, undefined, plaidHttp);

// Products we want to access
// Note: Auth is commented out for sandbox testing - it triggers the "Save with Plaid" flow
// Once configured in Plaid dashboard, uncomment Auth and Identity
export const PLAID_PRODUCTS: Products[] = [
  Products.Transactions,
  // Products.Auth,    // Requires additional Plaid dashboard configuration
  // Products.Identity, // Requires additional Plaid dashboard configuration
  //Products.Liabilities,
];

// Country codes we support
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];

// Check if Plaid is configured
export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// Types for our app
export interface PlaidAccount {
  id: string;
  user_id: string;
  account_id: string;
  item_id: string;
  name: string;
  official_name: string | null;
  type: "checking" | "savings" | "credit" | "loan" | "investment" | "other";
  subtype: string | null;
  mask: string | null;
  current_balance: number;
  available_balance: number | null;
  credit_limit: number | null;
  iso_currency_code: string;
  institution_id: string | null;
  institution_name: string | null;
  last_updated: string;
  created_at: string;
}

export interface PlaidTransaction {
  id: string;
  user_id: string;
  account_id: string;
  transaction_id: string;
  amount: number;
  iso_currency_code: string;
  date: string;
  datetime: string | null;
  name: string;
  merchant_name: string | null;
  category: string[];
  category_id: string | null;
  pending: boolean;
  payment_channel: "online" | "in store" | "other";
  logo_url: string | null;
  created_at: string;
}

export interface PlaidConnection {
  id: string;
  user_id: string;
  item_id: string;
  access_token: string;
  institution_id: string | null;
  institution_name: string | null;
  status: "active" | "error" | "pending";
  error_code: string | null;
  error_message: string | null;
  consent_expiration: string | null;
  last_successful_update: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  merchant_name: string;
  amount: number;
  frequency: "monthly" | "yearly" | "weekly";
  category: string;
  logo_url: string | null;
  last_charged: string;
  next_charge: string | null;
  is_active: boolean;
  created_at: string;
}

// Category mappings for better display
export const CATEGORY_ICONS: Record<string, string> = {
  "Food and Drink": "🍔",
  Shops: "🛍️",
  Travel: "✈️",
  Transfer: "💸",
  Payment: "💳",
  Recreation: "🎮",
  Service: "🔧",
  Community: "🏘️",
  Healthcare: "🏥",
  "Bank Fees": "🏦",
  Interest: "📈",
  Tax: "📋",
  Rent: "🏠",
  Utilities: "💡",
  Subscription: "📱",
};

export const CATEGORY_COLORS: Record<string, string> = {
  "Food and Drink": "#F97316",
  Shops: "#8B5CF6",
  Travel: "#3B82F6",
  Transfer: "#6B7280",
  Payment: "#10B981",
  Recreation: "#EC4899",
  Service: "#F59E0B",
  Community: "#14B8A6",
  Healthcare: "#EF4444",
  "Bank Fees": "#64748B",
  Interest: "#22C55E",
  Tax: "#DC2626",
  Rent: "#7C3AED",
  Utilities: "#FBBF24",
  Subscription: "#06B6D4",
};

// Known subscription merchants
export const SUBSCRIPTION_MERCHANTS = [
  { pattern: /netflix/i, name: "Netflix", category: "Entertainment" },
  { pattern: /spotify/i, name: "Spotify", category: "Entertainment" },
  {
    pattern: /apple.*music|itunes/i,
    name: "Apple Music",
    category: "Entertainment",
  },
  {
    pattern: /amazon prime|amzn.*prime/i,
    name: "Amazon Prime",
    category: "Shopping",
  },
  { pattern: /hulu/i, name: "Hulu", category: "Entertainment" },
  { pattern: /disney/i, name: "Disney+", category: "Entertainment" },
  { pattern: /hbo.*max/i, name: "HBO Max", category: "Entertainment" },
  {
    pattern: /youtube.*premium/i,
    name: "YouTube Premium",
    category: "Entertainment",
  },
  {
    pattern: /gym|fitness|planet.*fitness|equinox/i,
    name: "Gym",
    category: "Health",
  },
  { pattern: /adobe/i, name: "Adobe", category: "Software" },
  {
    pattern: /microsoft.*365|office.*365/i,
    name: "Microsoft 365",
    category: "Software",
  },
  { pattern: /dropbox/i, name: "Dropbox", category: "Software" },
  {
    pattern: /google.*storage|google.*one/i,
    name: "Google One",
    category: "Software",
  },
  { pattern: /icloud/i, name: "iCloud", category: "Software" },
  {
    pattern: /at&t|verizon|t-mobile|sprint/i,
    name: "Phone",
    category: "Utilities",
  },
  {
    pattern: /xfinity|comcast|spectrum/i,
    name: "Internet",
    category: "Utilities",
  },
  { pattern: /pg&e|edison|electric/i, name: "Electric", category: "Utilities" },
];

// Detect if a transaction is a subscription
export function detectSubscription(transaction: PlaidTransaction): {
  isSubscription: boolean;
  merchant?: string;
  category?: string;
} {
  const name = transaction.merchant_name || transaction.name;

  for (const sub of SUBSCRIPTION_MERCHANTS) {
    if (sub.pattern.test(name)) {
      return {
        isSubscription: true,
        merchant: sub.name,
        category: sub.category,
      };
    }
  }

  return { isSubscription: false };
}

// Format currency
export function formatCurrency(
  amount: number,
  currency: string = "USD"
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}
