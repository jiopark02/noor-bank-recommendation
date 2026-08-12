import type { PlaidStateMode } from "@/lib/plaidChatContext";

// Shared decision surface for the three places in the chat route that decide
// whether Plaid-derived data reaches the LLM prompt (the "capability
// scaffold" block, the balance-keyword path, and the financial-analysis
// keyword path). The capability-scaffold and balance-keyword formulas below
// are copied verbatim from those channels' inline conditions in route.ts, so
// this module only makes them observable and independently testable. The
// financial-analysis channel is the exception: it no longer mirrors an inline
// condition and is switched off outright — see its case for why.

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
  // reason naming: condition results name what was evaluated (e.g. mode_off,
  // keyword_not_matched, mode_is_balances); a channel switched off entirely is
  // not a condition result and takes the channel_disabled_ prefix instead.
  // unknown_channel_fail_closed is in neither series: it names a fail-closed
  // fallback for a channel value outside the union, not an evaluated condition
  // and not a switched-off channel.
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
      // This channel is switched off unconditionally and reads no configuration.
      // Re-opening it requires reviewing the injection-path design at Plaid
      // production cutover.
      if (!input.wantsFinancialAnalysis) {
        return {
          channel: input.channel,
          allowed: false,
          reason: "keyword_not_matched",
        };
      }
      return {
        channel: input.channel,
        allowed: false,
        reason: "channel_disabled_transaction_policy_pending",
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
