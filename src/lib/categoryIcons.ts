// Icons for Plaid's legacy top-level transaction categories, for display only.
//
// Client-safe: this module imports nothing. It lives apart from
// "@/lib/plaid", which builds the Plaid API client when it is evaluated and
// so must not be imported as a value by a client page.

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
