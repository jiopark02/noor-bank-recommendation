import type { PlaidStateMode } from "@/lib/plaidChatContext";

// Shared decision surface for the three places in the chat route that decide
// whether Plaid-derived data reaches the LLM prompt (the "capability
// scaffold" block, the balance-keyword path, and the financial-analysis
// keyword path). Each channel's formula below is copied verbatim from that
// channel's existing inline condition in route.ts — this module makes the
// three decisions observable and independently testable, it does not change
// what any of them currently decide. See audit/plans/B6-plan.md.

export type PlaidEgressChannel =
  | "capability_scaffold"
  | "balance_keyword"
  | "financial_analysis_keyword";

export interface PlaidEgressPolicyInput {
  channel: PlaidEgressChannel;
  plaidStateMode: PlaidStateMode;
  wantsBalance?: boolean;
  wantsFinancialAnalysis?: boolean;
}

export interface PlaidEgressDecision {
  channel: PlaidEgressChannel;
  allowed: boolean;
  reason: string;
}

export function evaluatePlaidEgressDecision(
  input: PlaidEgressPolicyInput
): PlaidEgressDecision {
  switch (input.channel) {
    case "capability_scaffold": {
      const allowed = input.plaidStateMode !== "off";
      return {
        channel: input.channel,
        allowed,
        reason: allowed ? "mode_not_off" : "mode_off",
      };
    }
    case "balance_keyword": {
      if (!input.wantsBalance) {
        return {
          channel: input.channel,
          allowed: false,
          reason: "keyword_not_matched",
        };
      }
      const allowed = input.plaidStateMode !== "balances";
      return {
        channel: input.channel,
        allowed,
        reason: allowed
          ? "keyword_matched_mode_not_balances"
          : "mode_is_balances",
      };
    }
    case "financial_analysis_keyword": {
      const allowed = Boolean(input.wantsFinancialAnalysis);
      return {
        channel: input.channel,
        allowed,
        reason: allowed ? "keyword_matched_ungated" : "keyword_not_matched",
      };
    }
    default: {
      // Compile-time exhaustiveness: if PlaidEgressChannel grows a member
      // and this switch isn't updated, `tsc` fails the build. The runtime
      // fallback below still fires for any caller that reaches this
      // function with a value TypeScript didn't check (e.g. an any-typed
      // value crossing a boundary) — fail-closed either way.
      const _exhaustive: never = input.channel;
      return {
        channel: input.channel,
        allowed: false,
        reason: "unknown_channel_fail_closed",
      };
    }
  }
}

export function logPlaidEgressDecision(
  decision: PlaidEgressDecision,
  context: { mode: PlaidStateMode }
): void {
  console.debug(
    "[plaid-egress] channel=%s allowed=%s reason=%s mode=%s",
    decision.channel,
    decision.allowed,
    decision.reason,
    context.mode
  );
}
