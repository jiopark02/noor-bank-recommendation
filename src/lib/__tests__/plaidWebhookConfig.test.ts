import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { resolvePlaidWebhookUrl } from "../plaidWebhookConfig";

/**
 * PLAID_WEBHOOK_URL -> the `webhook` field of a link-token request. Each `it`
 * names the change to plaidWebhookConfig.ts that turns it red.
 */

const SECRET = "bypass-secret-value";

describe("resolvePlaidWebhookUrl", () => {
  it("omits the field when unset or empty, silently", () => {
    // Red if: an empty value is passed through (the request would change).
    const log = vi.fn();
    expect(resolvePlaidWebhookUrl(undefined, log)).toBeUndefined();
    expect(resolvePlaidWebhookUrl("", log)).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("returns an https URL unchanged, query string included", () => {
    const url = `https://preview.example.test/api/plaid/webhook?x-vercel-protection-bypass=${SECRET}`;
    expect(resolvePlaidWebhookUrl(url, vi.fn())).toBe(url);
    expect(
      resolvePlaidWebhookUrl("https://noor.example.test/api/plaid/webhook", vi.fn())
    ).toBe("https://noor.example.test/api/plaid/webhook");
  });

  it("omits a non-https or unparseable value and logs that, never the value", () => {
    // Red if: the protocol check is removed, or the value reaches the log.
    for (const raw of [
      `http://example.test/api/plaid/webhook?x-vercel-protection-bypass=${SECRET}`,
      `not a url ${SECRET}`,
      `ftp://example.test/${SECRET}`,
      `/api/plaid/webhook?${SECRET}`,
    ]) {
      const log = vi.fn();
      expect(resolvePlaidWebhookUrl(raw, log)).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0][0]);
      expect(line).toMatch(/^\[plaid-link\] webhook_url=invalid reason=/);
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("example.test");
    }
  });
});

// Source probe for the one call site (moved from plaidWebhookWiring.test.ts so
// each commit of the split stays green).

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const LINK = code(read("../../app/api/plaid/create-link-token/route.ts"));

describe("create-link-token wiring", () => {
  it("passes PLAID_WEBHOOK_URL through resolvePlaidWebhookUrl, and only when set", () => {
    // Red if: the field is added unconditionally, or the env var is used raw.
    expect(LINK).toContain("resolvePlaidWebhookUrl(process.env.PLAID_WEBHOOK_URL)");
    expect(LINK).toContain("...(webhook ? { webhook } : {})");
    expect(LINK).not.toMatch(/webhook:\s*process\.env/);
  });
});
