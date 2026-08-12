import { describe, it, expect, afterEach, vi } from "vitest";
import {
  evaluatePlaidEgressDecision,
  logPlaidEgressDecision,
  type PlaidEgressChannel,
} from "../plaidEgressPolicy";

describe("evaluatePlaidEgressDecision — capability_scaffold", () => {
  it("denies when mode is off", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "capability_scaffold",
      plaidStateMode: "off",
    });
    expect(decision).toEqual({
      channel: "capability_scaffold",
      allowed: false,
      reason: "mode_off",
    });
  });

  it("allows when mode is connection", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "capability_scaffold",
      plaidStateMode: "connection",
    });
    expect(decision).toEqual({
      channel: "capability_scaffold",
      allowed: true,
      reason: "mode_not_off",
    });
  });

  it("allows when mode is balances", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "capability_scaffold",
      plaidStateMode: "balances",
    });
    expect(decision).toEqual({
      channel: "capability_scaffold",
      allowed: true,
      reason: "mode_not_off",
    });
  });
});

describe("evaluatePlaidEgressDecision — balance_keyword", () => {
  it("denies when wantsBalance is false and mode is off", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode: "off",
      wantsBalance: false,
    });
    expect(decision).toEqual({
      channel: "balance_keyword",
      allowed: false,
      reason: "keyword_not_matched",
    });
  });

  it("denies when wantsBalance is false and mode is connection", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode: "connection",
      wantsBalance: false,
    });
    expect(decision).toEqual({
      channel: "balance_keyword",
      allowed: false,
      reason: "keyword_not_matched",
    });
  });

  it("denies when wantsBalance is false and mode is balances", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode: "balances",
      wantsBalance: false,
    });
    expect(decision).toEqual({
      channel: "balance_keyword",
      allowed: false,
      reason: "keyword_not_matched",
    });
  });

  it("allows when wantsBalance is true and mode is off", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode: "off",
      wantsBalance: true,
    });
    expect(decision).toEqual({
      channel: "balance_keyword",
      allowed: true,
      reason: "keyword_matched_mode_not_balances",
    });
  });

  it("allows when wantsBalance is true and mode is connection — current production config", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode: "connection",
      wantsBalance: true,
    });
    expect(decision).toEqual({
      channel: "balance_keyword",
      allowed: true,
      reason: "keyword_matched_mode_not_balances",
    });
  });

  it("denies when wantsBalance is true and mode is balances — the only case B is suppressed", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "balance_keyword",
      plaidStateMode: "balances",
      wantsBalance: true,
    });
    expect(decision).toEqual({
      channel: "balance_keyword",
      allowed: false,
      reason: "mode_is_balances",
    });
  });
});

// This channel is switched off unconditionally: every mode denies, and a
// matched keyword is reported with the channel_disabled_ reason rather than
// being allowed.
describe("evaluatePlaidEgressDecision — financial_analysis_keyword", () => {
  it("denies when wantsFinancialAnalysis is false and mode is off", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode: "off",
      wantsFinancialAnalysis: false,
    });
    expect(decision).toEqual({
      channel: "financial_analysis_keyword",
      allowed: false,
      reason: "keyword_not_matched",
    });
  });

  it("denies when wantsFinancialAnalysis is false and mode is connection", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode: "connection",
      wantsFinancialAnalysis: false,
    });
    expect(decision).toEqual({
      channel: "financial_analysis_keyword",
      allowed: false,
      reason: "keyword_not_matched",
    });
  });

  it("denies when wantsFinancialAnalysis is false and mode is balances", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode: "balances",
      wantsFinancialAnalysis: false,
    });
    expect(decision).toEqual({
      channel: "financial_analysis_keyword",
      allowed: false,
      reason: "keyword_not_matched",
    });
  });

  it("denies when wantsFinancialAnalysis is true and mode is off — channel is off unconditionally, not mode-gated", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode: "off",
      wantsFinancialAnalysis: true,
    });
    expect(decision).toEqual({
      channel: "financial_analysis_keyword",
      allowed: false,
      reason: "channel_disabled_transaction_policy_pending",
    });
  });

  it("denies when wantsFinancialAnalysis is true and mode is connection", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode: "connection",
      wantsFinancialAnalysis: true,
    });
    expect(decision).toEqual({
      channel: "financial_analysis_keyword",
      allowed: false,
      reason: "channel_disabled_transaction_policy_pending",
    });
  });

  it("denies when wantsFinancialAnalysis is true and mode is balances — no mode re-opens this channel", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "financial_analysis_keyword",
      plaidStateMode: "balances",
      wantsFinancialAnalysis: true,
    });
    expect(decision).toEqual({
      channel: "financial_analysis_keyword",
      allowed: false,
      reason: "channel_disabled_transaction_policy_pending",
    });
  });
});

describe("evaluatePlaidEgressDecision — unrecognized channel", () => {
  it("fails closed for a channel value outside the known union", () => {
    const decision = evaluatePlaidEgressDecision({
      channel: "not_a_real_channel" as unknown as PlaidEgressChannel,
      plaidStateMode: "balances",
      wantsBalance: true,
      wantsFinancialAnalysis: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("unknown_channel_fail_closed");
  });
});

describe("logPlaidEgressDecision", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs channel, allowed, reason, and mode as one structured line", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

    logPlaidEgressDecision(
      { channel: "capability_scaffold", allowed: true, reason: "mode_not_off" },
      { mode: "connection" }
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "[plaid-egress] channel=%s allowed=%s reason=%s mode=%s",
      "capability_scaffold",
      true,
      "mode_not_off",
      "connection"
    );
  });
});
