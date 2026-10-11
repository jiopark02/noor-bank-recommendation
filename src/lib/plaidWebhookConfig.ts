/**
 * The webhook URL registered on new Items, from PLAID_WEBHOOK_URL.
 *
 *   unset or ""                 -> undefined: the `webhook` field is omitted and
 *                                  the link-token request is byte-identical to
 *                                  what it was before this variable existed
 *   not a URL, or not https:    -> undefined, plus one `[plaid-link]` line
 *   an https URL                -> returned as given
 *
 * THE VALUE IS NEVER LOGGED, NOT EVEN IN PART. On Preview it carries a Vercel
 * protection-bypass secret in its query string. An invalid value does not block
 * linking a bank; the Item is simply created without a webhook.
 */
export function resolvePlaidWebhookUrl(
  raw: string | undefined,
  log: (line: string) => void = console.error
): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    log("[plaid-link] webhook_url=invalid reason=unparseable");
    return undefined;
  }
  if (parsed.protocol !== "https:") {
    log("[plaid-link] webhook_url=invalid reason=not_https");
    return undefined;
  }
  return raw;
}
