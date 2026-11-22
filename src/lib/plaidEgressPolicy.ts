import type { PlaidStateMode } from "@/lib/plaidChatContext";

// Shared decision surface for every place in the chat route that decides
// whether Plaid-derived data reaches the LLM prompt:
//   capability_scaffold  whether the bank-state block, and the one bank read
//                        behind it, happen at all.
//   balance_keyword      whether a balance question raises that read to
//                        depth "balances" (live account balances) under
//                        "connection". It reads nothing itself. Under
//                        "balances" the read is already at that depth on every
//                        turn but a greeting, so this channel denies there.
//   financial_analysis_keyword
//                        switched off outright — see its case for why.
//   household_shared     whether bank data another household member shares
//                        with the user (connections and balances) is read
//                        into this turn's prompt. Only on a household turn,
//                        only when something is shared, and only while the
//                        chat's shared-data switch is on; when it allows, the
//                        user's own read also goes to depth "balances".
// Every channel also denies under "off": before that held, "off" stopped the
// scaffold but still let a balance question pull a live balance into the
// prompt.

// Under AI_PLAID_STATE=off every channel denies, so "off" is a working
// emergency switch for fresh bank data reaching the model. The channel type is
// derived from this list, so a new channel cannot exist without appearing here,
// and the test that walks this list under "off" covers it.
export const PLAID_EGRESS_CHANNELS = [
  "capability_scaffold",
  "balance_keyword",
  "financial_analysis_keyword",
  "household_shared",
] as const;

export type PlaidEgressChannel = (typeof PLAID_EGRESS_CHANNELS)[number];

export interface PlaidEgressPolicyInput {
  channel: PlaidEgressChannel;
  plaidStateMode: PlaidStateMode;
  wantsBalance?: boolean;
  wantsFinancialAnalysis?: boolean;
  /** household_shared: the chat's shared-data switch is on. */
  sharedStateEnabled?: boolean;
  /** household_shared: at least one connection is shared with the user. */
  hasSharedConnections?: boolean;
  /** household_shared: this turn is about the household. */
  householdTurn?: boolean;
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
      if (input.plaidStateMode === "off") {
        return {
          channel: input.channel,
          allowed: false,
          reason: "mode_off",
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
    case "household_shared": {
      // Every condition is checked in this order, so the reason names the
      // first one that failed. "off" comes first: it closes this channel as
      // it closes every other.
      if (input.plaidStateMode === "off") {
        return { channel: input.channel, allowed: false, reason: "mode_off" };
      }
      if (input.sharedStateEnabled !== true) {
        return { channel: input.channel, allowed: false, reason: "switch_off" };
      }
      if (input.hasSharedConnections !== true) {
        return { channel: input.channel, allowed: false, reason: "nothing_shared" };
      }
      if (input.householdTurn !== true) {
        return {
          channel: input.channel,
          allowed: false,
          reason: "not_household_turn",
        };
      }
      return {
        channel: input.channel,
        allowed: true,
        reason: "household_turn_mode_not_off",
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
