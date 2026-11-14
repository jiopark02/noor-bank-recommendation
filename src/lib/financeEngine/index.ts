// =============================================================================
// What remains of the in-app finance engine.
//
// The figures the screens show are computed by the cash-flow engine package
// (see plaidEngineAdapter.ts). This directory keeps only what the adapter
// and the summary still need from the app itself:
//   - the money and date helpers the adapter reads Plaid's values with;
//   - the card-payment category rule the adapter logs streams by;
//   - credit utilization, which the app computes and sends with the summary;
//   - the types of the adapter's normalized read.
// =============================================================================

export { toCents, isCents } from "./money";
export { isIsoDate, dayNumber, fromDayNumber, parseTimestampMs, freshnessOf } from "./dates";
export { isCardPaymentCategory } from "./classify";
export { computeCreditUtilization, creditUtilizationOf } from "./creditUtilization";
export type * from "./types";
