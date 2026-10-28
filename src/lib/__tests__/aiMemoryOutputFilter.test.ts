import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The output filter sits where aiMemory.ts writes text: createSummary masks,
 * saveUserFact and supersedeUserFact refuse. These tests run those functions
 * against a fake Supabase client that records every table touched and every
 * row written.
 */

interface Call {
  table: string;
  op: string;
  payload?: unknown;
}

const calls: Call[] = [];

function chain(table: string): Record<string, unknown> {
  const result = { data: { id: "row-1" }, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "is",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ]) {
    builder[method] = () => builder;
  }
  builder.insert = (payload: unknown) => {
    calls.push({ table, op: "insert", payload });
    return builder;
  };
  builder.update = (payload: unknown) => {
    calls.push({ table, op: "update", payload });
    return builder;
  };
  builder.then = (resolve: (value: typeof result) => unknown) =>
    Promise.resolve(result).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => {
      calls.push({ table, op: "from" });
      return chain(table);
    },
  }),
}));

import {
  SensitiveFactRejectedError,
  createSummary,
  isSensitiveFactRejected,
  saveUserFact,
  supersedeUserFact,
} from "../aiMemory";

const USER = "00000000-0000-0000-0000-000000000001";
const SESSION = "00000000-0000-0000-0000-000000000002";
const OLD_FACT = "00000000-0000-0000-0000-000000000003";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function inserts(table: string): unknown[] {
  return calls
    .filter((c) => c.table === table && c.op === "insert")
    .map((c) => c.payload);
}

describe("saveUserFact", () => {
  it("refuses a fact holding an SSN before touching the database", async () => {
    await expect(
      saveUserFact(USER, {
        category: "personal",
        fact: "User's SSN is 123-45-6789.",
      })
    ).rejects.toBeInstanceOf(SensitiveFactRejectedError);
    expect(calls).toEqual([]);
  });

  it("refuses a fact holding a card number, and logs only the count", async () => {
    const error = await saveUserFact(USER, {
      category: "banking",
      fact: "User's card is 4111 1111 1111 1111.",
    }).catch((e: unknown) => e);
    expect(isSensitiveFactRejected(error)).toBe(true);
    expect((error as Error).message).not.toMatch(/\d{4}/);
    expect(warn).toHaveBeenCalledWith("[memory-filter] kind=fact masked=%d", 1);
    expect(calls).toEqual([]);
  });

  it("stores an ordinary fact unchanged", async () => {
    await saveUserFact(USER, {
      category: "financial",
      fact: "User pays $1,700 rent in cash.",
    });
    expect(inserts("user_facts")).toHaveLength(1);
    expect(
      (inserts("user_facts")[0] as { fact: string }).fact
    ).toBe("User pays $1,700 rent in cash.");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("supersedeUserFact", () => {
  it("refuses a sensitive replacement before the ownership check and before step 1", async () => {
    await expect(
      supersedeUserFact(USER, OLD_FACT, {
        category: "personal",
        fact: "User's social security number is 123456789.",
      })
    ).rejects.toBeInstanceOf(SensitiveFactRejectedError);
    expect(calls).toEqual([]);
  });

  it("still supersedes with an ordinary replacement", async () => {
    await supersedeUserFact(USER, OLD_FACT, {
      category: "financial",
      fact: "User's rent is now $1,800.",
    });
    expect(
      calls.some((c) => c.table === "user_facts" && c.op === "update")
    ).toBe(true);
    expect(inserts("user_facts")).toHaveLength(1);
  });
});

describe("crisis content in a fact", () => {
  const CRISIS_FACT = "User wants to kill themselves.";

  function consoleSpies(): Array<ReturnType<typeof vi.spyOn>> {
    return [
      warn,
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
  }

  it("saveUserFact refuses it before touching the database, and logs nothing", async () => {
    const spies = consoleSpies();
    await expect(
      saveUserFact(USER, { category: "personal", fact: CRISIS_FACT })
    ).rejects.toBeInstanceOf(SensitiveFactRejectedError);
    expect(calls).toEqual([]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("supersedeUserFact refuses it before the ownership check, so the old fact is untouched", async () => {
    const spies = consoleSpies();
    await expect(
      supersedeUserFact(USER, OLD_FACT, { category: "personal", fact: CRISIS_FACT })
    ).rejects.toBeInstanceOf(SensitiveFactRejectedError);
    expect(calls).toEqual([]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("with an SSN as well, logs only the identifier count line", async () => {
    const spies = consoleSpies();
    await expect(
      saveUserFact(USER, {
        category: "personal",
        fact: "User's SSN is 123-45-6789 and they want to kill themselves.",
      })
    ).rejects.toBeInstanceOf(SensitiveFactRejectedError);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[memory-filter] kind=fact masked=%d", 1);
    for (const spy of spies.slice(1)) expect(spy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("the rejection message names neither the text nor the check", async () => {
    const error = await saveUserFact(USER, {
      category: "personal",
      fact: CRISIS_FACT,
    }).catch((e: unknown) => e);
    expect(isSensitiveFactRejected(error)).toBe(true);
    expect((error as Error).message).not.toMatch(/kill|crisis|suicid/i);
  });
});

describe("createSummary", () => {
  it("masks the summary, every topic and raw_backup, and logs only the count", async () => {
    await createSummary(SESSION, USER, {
      summary: "The user shared SSN 123-45-6789 and card 4111111111111111.",
      topics: ["budgeting", "card 4111 1111 1111 1111"],
      rawBackup: "User: my ssn is 987654321",
    });
    const [row] = inserts("chat_summaries") as Array<{
      summary: string;
      topics: string[];
      raw_backup: string | null;
    }>;
    expect(row.summary).toBe(
      "The user shared SSN [redacted] and card [redacted]."
    );
    expect(row.topics).toEqual(["budgeting", "card [redacted]"]);
    expect(row.raw_backup).toBe("User: my ssn is [redacted]");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[memory-filter] kind=summary masked=%d",
      4
    );
  });

  it("stores an ordinary summary unchanged and logs nothing", async () => {
    await createSummary(SESSION, USER, {
      summary: "The user pays $1,200 rent in cash and gets $800 a month from family.",
      topics: ["rent"],
    });
    const [row] = inserts("chat_summaries") as Array<{
      summary: string;
      topics: string[];
      raw_backup: string | null;
    }>;
    expect(row.summary).toBe(
      "The user pays $1,200 rent in cash and gets $800 a month from family."
    );
    expect(row.topics).toEqual(["rent"]);
    expect(row.raw_backup).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("extract-facts cron wiring", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../app/api/cron/extract-facts/route.ts", import.meta.url)
    ),
    "utf8"
  ).replace(/\r\n?/g, "\n");

  it("skips the supersede recovery for a filtered fact", () => {
    const catchAt = source.indexOf("} catch (supersedeError) {");
    const checkAt = source.indexOf(
      "if (isSensitiveFactRejected(supersedeError)) {",
      catchAt
    );
    const recoveryAt = source.indexOf(
      "await saveUserFact(session.user_id, payload);",
      catchAt
    );
    expect(checkAt).toBeGreaterThan(catchAt);
    expect(recoveryAt).toBeGreaterThan(checkAt);
    const branch = source.slice(checkAt, recoveryAt);
    expect(branch).toContain("stats.filtered++;");
    expect(branch).toContain("continue;");
  });

  it("counts a filtered new fact as filtered, not failed", () => {
    expect(source).toContain(
      "if (isSensitiveFactRejected(saveError)) {"
    );
    expect(source).toContain("stats.factsFiltered += sessionStats.filtered;");
  });
});
