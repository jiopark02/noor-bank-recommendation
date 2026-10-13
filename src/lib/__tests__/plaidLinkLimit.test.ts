import { describe, it, expect } from "vitest";
import {
  CONNECTION_LIMIT,
  CONNECTION_LIMIT_CODE,
  linkLimitRefusal,
} from "../plaidExchange";

/**
 * The connection-limit check create-link-token runs before Link opens.
 *
 * Executed, not probed. It fails OPEN on an unreadable count, the opposite of
 * the check before the exchange (plaidExchange.test.ts), because it only spares
 * the user a wasted Link session; the exchange check is what holds the limit.
 *
 * Nothing here proves create-link-token calls it — that wiring is source only.
 */

describe("linkLimitRefusal", () => {
  it("refuses at the limit with the code PlaidLinkButton keys on", () => {
    // MUTATION: `count < CONNECTION_LIMIT` -> `count <= CONNECTION_LIMIT`.
    const refusal = linkLimitRefusal(CONNECTION_LIMIT);
    expect(refusal?.status).toBe(422);
    expect(refusal?.body.code).toBe(CONNECTION_LIMIT_CODE);
    // PlaidLinkButton compares against this literal; keep the two in step.
    expect(CONNECTION_LIMIT_CODE).toBe("CONNECTION_LIMIT_REACHED");
    expect(typeof refusal?.body.error).toBe("string");
  });

  it("lets Link open below the limit", () => {
    // MUTATION: comparing against CONNECTION_LIMIT - 1.
    expect(linkLimitRefusal(CONNECTION_LIMIT - 1)).toBeNull();
  });

  it("lets Link open when the count could not be read", () => {
    // MUTATION: treating null as at-limit (fail closed).
    expect(linkLimitRefusal(null)).toBeNull();
  });
});
