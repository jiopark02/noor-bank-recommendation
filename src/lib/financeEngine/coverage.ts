import type { Completeness, EngineConnection, EngineInput } from "./types";

/** What the connections allow, before safe-to-spend is computed. */
export interface CoverageDecision {
  completeness: Completeness;
  allConnectionsRead: boolean;
  /**
   * Recurring charges are known: every connection was read, none of their
   * recurring reads failed or was skipped, and at least one outflow stream
   * came back. An empty answer from every bank is treated as unknown, not as
   * "none": Plaid needs enough history to detect a stream, so empty does not
   * prove absence.
   */
  recurringAvailable: boolean;
}

function isRead(c: EngineConnection | null | undefined): c is EngineConnection {
  return !!c && c.state === "ok";
}

function recurringAnswered(c: EngineConnection): boolean {
  return c.recurringRead === "ok" || c.recurringRead === "empty";
}

/**
 * Decides, from the connections alone, how complete the figures are and
 * whether recurring charges are known. A malformed connection entry counts
 * as not read. `outflowStreamCount` is the number of outflow streams the
 * connections returned in all.
 */
export function computeCoverage(
  connections: EngineConnection[],
  outflowStreamCount: number
): CoverageDecision {
  let allRead = connections.length > 0;
  let anyTruncated = false;
  let allRecurringAnswered = true;
  for (let i = 0; i < connections.length; i++) {
    const c = connections[i];
    if (!isRead(c)) {
      allRead = false;
      continue;
    }
    if (c.transactionsTruncated === true) anyTruncated = true;
    if (!recurringAnswered(c)) allRecurringAnswered = false;
  }
  const completeness: Completeness = !allRead
    ? "unknown"
    : anyTruncated
      ? "possibly_truncated"
      : "complete";
  return {
    completeness,
    allConnectionsRead: allRead,
    recurringAvailable: allRead && allRecurringAnswered && outflowStreamCount > 0,
  };
}

/** computeCoverage over an engine input. */
export function coverageOf(input: EngineInput): CoverageDecision {
  return computeCoverage(input.connections, input.recurring.streams.length);
}
