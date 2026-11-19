import { describe, it, expect } from "vitest";
import {
  connectionStatusLabel,
  linkedBankRows,
  parseFinanceSummaryResponse,
  type ScreenSummaryResponse,
} from "../bankSummaryView";

/**
 * The rows of the money screen's linked-bank list, and the status label each
 * one carries.
 *
 * Mutations that turn this file red:
 *   - the label decided from the listed connection's stored status
 *   - a default label when there is no summary
 *   - a default label for a bank the summary does not name
 *   - the label looked up in an object, or a label for an unknown status
 *   - a row left out because it has no label
 *   - no label for a bank the summary could not read, when no bank was read
 */

/** A listed connection as the connection list gives it, stored status included. */
function listed(n: number, status: "active" | "error" = "active") {
  return {
    itemId: `item-${n}`,
    institutionName: `Bank ${n}`,
    status,
    createdAt: "2026-11-01T00:00:00Z",
  };
}

type Status = ScreenSummaryResponse["connections"][number]["status"];

/** A summary response in which no bank was read, so it carries no figures. */
function summaryOf(connections: Array<[number, Status]>): ScreenSummaryResponse {
  return {
    connections: connections.map(([n, status]) => ({
      itemId: `item-${n}`,
      institutionName: `Bank ${n}`,
      status,
    })),
    accounts: [],
    summary: null,
  };
}

describe("linkedBankRows — the label follows the summary", () => {
  it("says what the summary read, whatever the stored status is", () => {
    const rows = linkedBankRows(
      [listed(1, "error"), listed(2, "active"), listed(3, "active"), listed(4, "active")],
      summaryOf([
        [1, "ok"],
        [2, "login_required"],
        [3, "syncing"],
        [4, "failed"],
      ])
    );
    expect(rows.map((r) => r.statusLabel)).toEqual([
      "Connected",
      "Sign-in needed",
      "Importing",
      "Couldn't reach",
    ]);
  });

  it("matches by item id, not by position", () => {
    const rows = linkedBankRows(
      [listed(1), listed(2)],
      summaryOf([
        [2, "login_required"],
        [1, "ok"],
      ])
    );
    expect(rows.map((r) => r.statusLabel)).toEqual(["Connected", "Sign-in needed"]);
  });
});

describe("linkedBankRows — no label", () => {
  it("has no label when there is no summary", () => {
    const rows = linkedBankRows([listed(1, "active"), listed(2, "error")], null);
    expect(rows.map((r) => r.statusLabel)).toEqual([null, null]);
  });

  it("has no label for a bank the summary does not name", () => {
    const rows = linkedBankRows([listed(1), listed(2)], summaryOf([[1, "ok"]]));
    expect(rows.map((r) => r.statusLabel)).toEqual(["Connected", null]);
  });

  it("has no label for a status that is not one of the summary's", () => {
    for (const status of ["broken", "", "constructor", "toString", "OK", "active"]) {
      expect(connectionStatusLabel(status), status).toBeNull();
      const response = summaryOf([[1, status as Status]]);
      expect(linkedBankRows([listed(1)], response)[0].statusLabel, status).toBeNull();
    }
  });
});

describe("linkedBankRows — rows", () => {
  it("gives one row per listed connection, in order, labelled or not", () => {
    const rows = linkedBankRows(
      [listed(1), listed(2), listed(3, "error")],
      summaryOf([[1, "ok"]])
    );
    expect(rows).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", statusLabel: "Connected" },
      { itemId: "item-2", institutionName: "Bank 2", statusLabel: null },
      { itemId: "item-3", institutionName: "Bank 3", statusLabel: null },
    ]);
    expect(linkedBankRows([listed(1), listed(2)], null)).toHaveLength(2);
    expect(linkedBankRows([], summaryOf([[1, "ok"]]))).toEqual([]);
  });
});

describe("linkedBankRows — a summary in which no bank was read", () => {
  it("still labels the bank that could not be reached", () => {
    // The body the summary route answers when every read failed: no figures,
    // and the connections with their statuses.
    const body: unknown = {
      success: true,
      connections: [{ itemId: "item-1", institutionName: "Bank 1", status: "failed" }],
      accounts: [],
      summary: null,
      transactions: [],
    };
    const parsed = parseFinanceSummaryResponse(body);
    expect(parsed).not.toBeNull();
    expect(linkedBankRows([listed(1)], parsed)).toEqual([
      { itemId: "item-1", institutionName: "Bank 1", statusLabel: "Couldn't reach" },
    ]);
  });
});
