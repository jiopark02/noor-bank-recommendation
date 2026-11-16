import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The memory crons' state writes on chat_sessions and the candidate queries
 * that read that state. Each test runs the real aiMemory function against a
 * fake Supabase client that records every builder call in order, so the exact
 * filters and the exact update payloads are asserted, not inferred.
 */

type Call = [string, unknown[]];

interface Chain {
  table: string;
  calls: Call[];
}

const chains: Chain[] = [];
let updateRows: unknown = [{ id: "s1" }];
let updateError: unknown = null;

function chain(table: string): Record<string, unknown> {
  const record: Chain = { table, calls: [] };
  chains.push(record);
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "not",
    "or",
    "is",
    "order",
    "limit",
    "single",
    "maybeSingle",
    "insert",
    "update",
  ]) {
    builder[method] = (...args: unknown[]) => {
      record.calls.push([method, args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => {
    const updated = record.calls.some(([method]) => method === "update");
    let result: unknown;
    if (updated) {
      result = { data: updateRows, error: updateError };
    } else if (table === "chat_summaries") {
      result = { data: { id: "summary-1" }, error: null };
    } else if (record.calls.some(([method]) => method === "maybeSingle")) {
      result = { data: { id: SESSION, ended_at: null }, error: null };
    } else {
      result = { data: [], error: null };
    }
    return Promise.resolve(result).then(resolve);
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => chain(table),
  }),
}));

import {
  createSummary,
  cronAttemptDueFilter,
  cronDonePayload,
  getSessionsNeedingFactsExtraction,
  getSessionsNeedingSummary,
  markFactsExtracted,
  markSessionSummarized,
  writeCronBackoff,
  writeCronCountedFailure,
  writeCronGiveUp,
} from "../aiMemory";

const USER = "00000000-0000-0000-0000-000000000001";
const SESSION = "00000000-0000-0000-0000-000000000002";
const NOW = "2026-11-11T10:00:00.000Z";
const LATER = "2026-11-11T12:00:00.000Z";

beforeEach(() => {
  chains.length = 0;
  updateRows = [{ id: SESSION }];
  updateError = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The update payloads sent to chat_sessions, in order. */
function sessionUpdates(): unknown[] {
  return chains
    .filter((c) => c.table === "chat_sessions")
    .flatMap((c) => c.calls.filter(([m]) => m === "update").map(([, a]) => a[0]));
}

function onlyChain(): Chain {
  expect(chains).toHaveLength(1);
  return chains[0];
}

describe("candidate queries", () => {
  it("summarize: unfinished, ended, and due — next attempt null or no later than now", async () => {
    await getSessionsNeedingSummary(24, NOW);
    const c = onlyChain();
    expect(c.table).toBe("chat_sessions");
    expect(c.calls).toEqual([
      ["select", ["*"]],
      ["eq", ["summarized", false]],
      ["not", ["ended_at", "is", null]],
      ["or", [`summary_next_attempt_at.is.null,summary_next_attempt_at.lte.${NOW}`]],
      ["order", ["ended_at", { ascending: true }]],
      ["limit", [24]],
    ]);
  });

  it("extract-facts: the same, on its own flag and its own columns", async () => {
    await getSessionsNeedingFactsExtraction(24, NOW);
    const c = onlyChain();
    expect(c.calls).toEqual([
      ["select", ["*"]],
      ["eq", ["facts_extracted", false]],
      ["not", ["ended_at", "is", null]],
      ["or", [`facts_next_attempt_at.is.null,facts_next_attempt_at.lte.${NOW}`]],
      ["order", ["ended_at", { ascending: true }]],
      ["limit", [24]],
    ]);
  });

  it("the due filter names one column only", () => {
    expect(cronAttemptDueFilter("summary", NOW)).not.toContain("facts_");
    expect(cronAttemptDueFilter("facts", NOW)).not.toContain("summary_");
  });
});

const SUMMARY_DONE = {
  summarized: true,
  summary_outcome: "done",
  summary_given_up_reason: null,
  summary_given_up_at: null,
  summary_next_attempt_at: null,
};

const FACTS_DONE = {
  facts_extracted: true,
  facts_outcome: "done",
  facts_given_up_reason: null,
  facts_given_up_at: null,
  facts_next_attempt_at: null,
};

describe("done payload", () => {
  it("is the flag, outcome 'done', and nothing else set", () => {
    expect(cronDonePayload("summary")).toEqual(SUMMARY_DONE);
    expect(cronDonePayload("facts")).toEqual(FACTS_DONE);
  });

  it("markSessionSummarized writes exactly the summary done payload, scoped to the user", async () => {
    await markSessionSummarized(SESSION, USER);
    const c = onlyChain();
    expect(c.calls).toEqual([
      ["update", [SUMMARY_DONE]],
      ["eq", ["id", SESSION]],
      ["eq", ["user_id", USER]],
    ]);
  });

  it("markFactsExtracted writes exactly the facts done payload, scoped to the user", async () => {
    await markFactsExtracted(SESSION, USER);
    const c = onlyChain();
    expect(c.calls).toEqual([
      ["update", [FACTS_DONE]],
      ["eq", ["id", SESSION]],
      ["eq", ["user_id", USER]],
    ]);
  });

  it("createSummary marks the session with the same payload markSessionSummarized writes", async () => {
    // The crisis gate marks through markSessionSummarized and an ordinary
    // summary through createSummary; the row must not tell them apart.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await createSummary(SESSION, USER, { summary: "The user rents." });
    await markSessionSummarized(SESSION, USER);
    const updates = sessionUpdates();
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual(updates[1]);
    expect(updates[0]).toEqual(SUMMARY_DONE);
  });
});

describe("state writes", () => {
  it("backoff moves only the next attempt time, on an unfinished session", async () => {
    const result = await writeCronBackoff("summary", SESSION, USER, LATER);
    const c = onlyChain();
    expect(c.calls).toEqual([
      ["update", [{ summary_next_attempt_at: LATER }]],
      ["eq", ["id", SESSION]],
      ["eq", ["user_id", USER]],
      ["eq", ["summarized", false]],
      ["select", ["id"]],
    ]);
    expect(result).toEqual({ updated: 1 });
  });

  it("a counted failure adds one, guarded by the count it read", async () => {
    await writeCronCountedFailure("facts", SESSION, USER, 1, LATER);
    const c = onlyChain();
    expect(c.calls).toEqual([
      ["update", [{ facts_failures: 2, facts_next_attempt_at: LATER }]],
      ["eq", ["id", SESSION]],
      ["eq", ["user_id", USER]],
      ["eq", ["facts_extracted", false]],
      ["eq", ["facts_failures", 1]],
      ["select", ["id"]],
    ]);
  });

  it("giving up is one update with the flag, outcome, reason and time together", async () => {
    await writeCronGiveUp("summary", SESSION, USER, 2, "output_unusable", NOW);
    const c = onlyChain();
    expect(c.calls.filter(([m]) => m === "update")).toHaveLength(1);
    expect(c.calls).toEqual([
      [
        "update",
        [
          {
            summarized: true,
            summary_outcome: "given_up",
            summary_given_up_reason: "output_unusable",
            summary_given_up_at: NOW,
            summary_failures: 3,
            summary_next_attempt_at: null,
          },
        ],
      ],
      ["eq", ["id", SESSION]],
      ["eq", ["user_id", USER]],
      ["eq", ["summarized", false]],
      ["eq", ["summary_failures", 2]],
      ["select", ["id"]],
    ]);
  });

  it("reports zero rows when another run changed the session first", async () => {
    updateRows = [];
    expect(
      await writeCronCountedFailure("summary", SESSION, USER, 0, LATER)
    ).toEqual({ updated: 0 });
  });

  it("throws on a database error and on a missing row list", async () => {
    updateError = { message: "boom", code: "08006" };
    await expect(writeCronBackoff("facts", SESSION, USER, LATER)).rejects.toThrow(
      "Failed to write facts cron state"
    );
    updateError = null;
    updateRows = null;
    await expect(writeCronBackoff("facts", SESSION, USER, LATER)).rejects.toThrow(
      "no row list returned"
    );
  });

  it("refuses a failure count that is not a non-negative integer", async () => {
    await expect(
      writeCronCountedFailure("summary", SESSION, USER, -1, LATER)
    ).rejects.toThrow("non-negative integer");
    await expect(
      writeCronGiveUp("summary", SESSION, USER, 1.5, "input_rejected", NOW)
    ).rejects.toThrow("non-negative integer");
    expect(chains).toHaveLength(0);
  });
});

/**
 * A mirror of the checks the migration puts on chat_sessions. The mirror is
 * pinned to the migration's text below; whether the database enforces it is
 * checked against the database, not here.
 */
const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20261111120000_add_cron_retry_state_to_chat_sessions.sql",
      import.meta.url
    )
  ),
  "utf8"
).replace(/\r\n?/g, "\n");

type Row = Record<string, unknown>;

function passesChecks(prefix: "summary" | "facts", row: Row): boolean {
  const failures = row[`${prefix}_failures`];
  const outcome = row[`${prefix}_outcome`];
  const reason = row[`${prefix}_given_up_reason`];
  const at = row[`${prefix}_given_up_at`];
  const failuresOk = typeof failures === "number" && failures >= 0;
  // `x in (...)` is not false for null, so a null passes.
  const outcomeOk = outcome === null || outcome === "done" || outcome === "given_up";
  const reasonOk =
    reason === null || reason === "output_unusable" || reason === "input_rejected";
  const pairOk =
    (outcome === "given_up") === (reason !== null) &&
    (reason === null) === (at === null);
  return failuresOk && outcomeOk && reasonOk && pairOk;
}

describe("every write passes the migration's checks, from every prior state", () => {
  it.each(["summary", "facts"] as const)("%s: the mirror matches the migration text", (prefix) => {
    expect(MIGRATION).toContain(`check (${prefix}_failures >= 0)`);
    expect(MIGRATION).toContain(`check (${prefix}_outcome in ('done', 'given_up'))`);
    expect(MIGRATION).toContain(
      `check (${prefix}_given_up_reason in ('output_unusable', 'input_rejected'))`
    );
    expect(MIGRATION).toContain(
      `(${prefix}_outcome is not distinct from 'given_up') = (${prefix}_given_up_reason is not null)\n` +
        `      and (${prefix}_given_up_reason is null) = (${prefix}_given_up_at is null)`
    );
  });

  it.each(["summary", "facts"] as const)("%s", async (prefix) => {
    const flag = prefix === "summary" ? "summarized" : "facts_extracted";
    const fresh: Row = {
      [flag]: false,
      [`${prefix}_failures`]: 0,
      [`${prefix}_next_attempt_at`]: null,
      [`${prefix}_outcome`]: null,
      [`${prefix}_given_up_reason`]: null,
      [`${prefix}_given_up_at`]: null,
    };
    const priors: Row[] = [
      fresh,
      { ...fresh, [flag]: true, [`${prefix}_outcome`]: "done" },
      {
        ...fresh,
        [flag]: true,
        [`${prefix}_failures`]: 3,
        [`${prefix}_outcome`]: "given_up",
        [`${prefix}_given_up_reason`]: "input_rejected",
        [`${prefix}_given_up_at`]: NOW,
      },
    ];
    for (const prior of priors) expect(passesChecks(prefix, prior)).toBe(true);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    if (prefix === "summary") {
      await markSessionSummarized(SESSION, USER);
      await createSummary(SESSION, USER, { summary: "The user rents." });
    } else {
      await markFactsExtracted(SESSION, USER);
    }
    await writeCronBackoff(prefix, SESSION, USER, LATER);
    await writeCronCountedFailure(prefix, SESSION, USER, 0, LATER);
    await writeCronGiveUp(prefix, SESSION, USER, 2, "output_unusable", NOW);
    await writeCronGiveUp(prefix, SESSION, USER, 2, "input_rejected", NOW);

    const payloads = sessionUpdates() as Row[];
    expect(payloads.length).toBeGreaterThanOrEqual(5);
    for (const payload of payloads) {
      for (const prior of priors) {
        expect(passesChecks(prefix, { ...prior, ...payload }), JSON.stringify(payload)).toBe(true);
      }
    }
  });
});
