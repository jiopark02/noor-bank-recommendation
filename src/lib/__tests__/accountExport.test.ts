import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  buildAccountExport,
  EXPORT_PAGE_SIZE,
  EXPORT_SECTIONS,
  makeSupabasePageReader,
  type ExportKeyType,
  type ExportRow,
  type ExportSection,
  type PageRequest,
  type ReadPage,
} from "../accountExport";

/**
 * GET /api/account/export, executed through buildAccountExport with a fake
 * page reader (no vi.mock, no auth boundary — the route is probed by source
 * at the end).
 *
 * The fake answers a page the way the keyset asks PostgreSQL to: the caller's
 * rows, ordered by the section's key, those greater than afterKey, at most
 * `limit` of them, projected to the select. Its comparison follows the key
 * type — uuid as the canonical lowercase string, int8 as a number — and it
 * refuses an int8 key that arrives as anything but a number. Whether this is
 * how PostgreSQL and PostgREST compare `gt` on these columns is checked live,
 * not here.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function uuidFor(i: number): string {
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

function compareKeys(a: unknown, b: unknown, type: ExportKeyType): number {
  if (type === "int8") return (a as number) - (b as number);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function project(row: ExportRow, select: string): ExportRow {
  if (select === "*") return { ...row };
  const out: ExportRow = {};
  for (const column of select.split(",").map((c) => c.trim())) {
    out[column] = row[column];
  }
  return out;
}

type FakeOptions = {
  /** Answer with an error on this call number (1-based) for this table. */
  failOn?: { table: string; call: number };
};

function fakeReader(
  rowsByTable: Record<string, ExportRow[]>,
  sections: readonly ExportSection[] = EXPORT_SECTIONS,
  options: FakeOptions = {}
) {
  const calls: PageRequest[] = [];
  const keyTypes: Record<string, ExportKeyType> = {};
  for (const s of sections) keyTypes[s.table] = s.orderKeyType;

  const readPage: ReadPage = async (request) => {
    calls.push({ ...request });
    const callNumber = calls.filter((c) => c.table === request.table).length;
    if (
      options.failOn &&
      options.failOn.table === request.table &&
      options.failOn.call === callNumber
    ) {
      return { data: null, error: { message: "boom" } };
    }

    const type = keyTypes[request.table];
    if (
      type === "int8" &&
      request.afterKey !== undefined &&
      typeof request.afterKey !== "number"
    ) {
      return { data: null, error: { message: "int8 key compared as text" } };
    }

    const rows = (rowsByTable[request.table] ?? [])
      .filter((r) => r[request.filterColumn] === request.userId)
      .filter(
        (r) =>
          request.afterKey === undefined ||
          compareKeys(r[request.orderColumn], request.afterKey, type) > 0
      )
      .sort((a, b) =>
        compareKeys(a[request.orderColumn], b[request.orderColumn], type)
      )
      .slice(0, request.limit)
      .map((r) => project(r, request.select));
    return { data: rows, error: null };
  };

  return { readPage, calls };
}

function sectionFor(table: string): ExportSection {
  const section = EXPORT_SECTIONS.find((s) => s.table === table);
  if (!section) throw new Error(`no section for ${table}`);
  return section;
}

/** chat_messages rows for USER, inserted in reverse key order, plus noise. */
function messages(n: number): ExportRow[] {
  const rows: ExportRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    rows.push({ id: uuidFor(i), user_id: USER, content: `m${i}` });
  }
  rows.push({ id: uuidFor(n + 5), user_id: OTHER, content: "not yours" });
  return rows;
}

function plaidRows(ids: number[]): ExportRow[] {
  return ids.map((id) => ({
    id,
    user_id: USER,
    institution_name: `bank${id}`,
    status: "active",
    item_id: `item${id}`,
    access_token: "v1:secret",
  }));
}

const MESSAGES = sectionFor("chat_messages");
const PLAID = sectionFor("plaid_connections");

function callsFor(calls: PageRequest[], table: string): PageRequest[] {
  return calls.filter((c) => c.table === table);
}

async function exportOf(
  rowsByTable: Record<string, ExportRow[]>,
  sections: readonly ExportSection[],
  options: FakeOptions = {},
  pageSize?: number
) {
  const fake = fakeReader(rowsByTable, sections, options);
  const result = await buildAccountExport(USER, fake.readPage, {
    sections,
    pageSize,
  });
  return { result, calls: fake.calls };
}

describe("account export: keyset page boundaries", () => {
  it("E1 exactly one full page: the second read asks after the last key, is empty and ends the section", async () => {
    const { result, calls } = await exportOf(
      { chat_messages: messages(EXPORT_PAGE_SIZE) },
      [MESSAGES]
    );
    expect(result.status).toBe(200);

    const reads = callsFor(calls, "chat_messages");
    expect(reads).toHaveLength(2);
    expect(reads[0].afterKey).toBeUndefined();
    expect(reads[1].afterKey).toBe(uuidFor(EXPORT_PAGE_SIZE - 1));

    const ids = (result.body.chat_messages as ExportRow[]).map((r) => r.id);
    const expected = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => uuidFor(i));
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("E2 one row past a full page: the second read asks after the last key of page one and returns the rest", async () => {
    const n = EXPORT_PAGE_SIZE + 1;
    const { result, calls } = await exportOf({ chat_messages: messages(n) }, [
      MESSAGES,
    ]);
    expect(result.status).toBe(200);

    const reads = callsFor(calls, "chat_messages");
    expect(reads).toHaveLength(2);
    expect(reads[1].afterKey).toBe(uuidFor(EXPORT_PAGE_SIZE - 1));

    const ids = (result.body.chat_messages as ExportRow[]).map((r) => r.id);
    expect(ids).toEqual(Array.from({ length: n }, (_, i) => uuidFor(i)));
    expect(new Set(ids).size).toBe(n);
  });

  it("E2 one row past a full page, int8 key: every row once, the key passed on as the number it is", async () => {
    const ids = Array.from({ length: EXPORT_PAGE_SIZE + 1 }, (_, i) => i + 1);
    const { result, calls } = await exportOf(
      { plaid_connections: plaidRows([...ids].reverse()) },
      [PLAID]
    );
    expect(result.status).toBe(200);

    const reads = callsFor(calls, "plaid_connections");
    expect(reads).toHaveLength(2);
    expect(reads[1].afterKey).toBe(EXPORT_PAGE_SIZE);

    const items = (result.body.plaid_connections as ExportRow[]).map((r) => r.item_id);
    expect(items).toEqual(ids.map((id) => `item${id}`));
    expect(new Set(items).size).toBe(ids.length);
  });

  it("E2b int8 keys are ordered as numbers, not as text", async () => {
    expect(PLAID.orderKeyType).toBe("int8");
    // As text, "10" < "11" < "9"; as numbers, 9 < 10 < 11.
    const { result, calls } = await exportOf(
      { plaid_connections: plaidRows([11, 9, 10]) },
      [PLAID],
      {},
      2
    );
    expect(result.status).toBe(200);
    const reads = callsFor(calls, "plaid_connections");
    expect(reads[1].afterKey).toBe(10);
    expect(typeof reads[1].afterKey).toBe("number");
    const items = (result.body.plaid_connections as ExportRow[]).map((r) => r.item_id);
    expect(items).toEqual(["item9", "item10", "item11"]);
  });

  it("E3 no rows: every section is present as an empty array after one read each", async () => {
    const { result, calls } = await exportOf({}, EXPORT_SECTIONS);
    expect(result.status).toBe(200);
    for (const section of EXPORT_SECTIONS) {
      expect(result.body[section.key], section.key).toEqual([]);
      expect(callsFor(calls, section.table), section.table).toHaveLength(1);
    }
  });
});

describe("account export: failure", () => {
  it("E4 an error on a middle page fails the whole export and stops reading that section", async () => {
    const { result, calls } = await exportOf(
      { chat_messages: messages(EXPORT_PAGE_SIZE * 2 + 500) },
      EXPORT_SECTIONS,
      { failOn: { table: "chat_messages", call: 2 } }
    );
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: "Failed to export some of your data. Please retry.",
    });
    expect(result.status === 500 && result.failedSections).toEqual([
      "chat_messages",
    ]);
    expect(callsFor(calls, "chat_messages")).toHaveLength(2);
  });

  it("a full page whose rows lack the key fails the export instead of restarting the section", async () => {
    let reads = 0;
    const readPage: ReadPage = async (request) => {
      reads += 1;
      return {
        data: Array.from({ length: request.limit }, () => ({ content: "x" })),
        error: null,
      };
    };
    const result = await buildAccountExport(USER, readPage, {
      sections: [MESSAGES],
    });
    expect(result.status).toBe(500);
    expect(reads).toBe(1);
  });
});

describe("account export: what each section reads", () => {
  /** The filter column each table is read by. */
  const EXPECTED_FILTER: Record<string, string> = {
    users: "id",
    survey_responses: "user_id",
    chat_sessions: "user_id",
    chat_messages: "user_id",
    chat_summaries: "user_id",
    user_facts: "user_id",
    plaid_connections: "user_id",
    llm_calls: "user_id",
    chat_usage_reservations: "user_id",
    email_confirmation_sends: "user_id",
  };

  /** Each table's primary key, the column the keyset pages on. */
  const EXPECTED_ORDER: Record<string, string> = {
    users: "id",
    survey_responses: "id",
    chat_sessions: "id",
    chat_messages: "id",
    chat_summaries: "id",
    user_facts: "id",
    plaid_connections: "id",
    llm_calls: "id",
    chat_usage_reservations: "id",
    email_confirmation_sends: "user_id",
  };

  it("E5 the file carries exactly these top-level keys", async () => {
    const { result } = await exportOf({}, EXPORT_SECTIONS);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual(
      [
        "exported_at",
        "user_id",
        "users",
        "survey_responses",
        "chat_sessions",
        "chat_messages",
        "chat_summaries",
        "user_facts",
        "plaid_connections",
        "llm_calls",
        "chat_usage_reservations",
        "email_confirmation_sends",
      ].sort()
    );
  });

  it("E6 no section reads a table the drop migration removes", () => {
    // Read from the migration itself, so a table added to it is covered here
    // without a second list to keep in step.
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../../../supabase/migrations/20261104130000_drop_unused_legacy_tables.sql",
          import.meta.url
        )
      ),
      "utf8"
    )
      .replace(/\r\n?/g, "\n")
      .replace(/--[^\n]*/g, "");
    const DROPPED: string[] = [];
    const drop = /drop table if exists public\.([a-z_][a-z0-9_]*);/g;
    let match: RegExpExecArray | null;
    while ((match = drop.exec(migration)) !== null) DROPPED.push(match[1]);
    // An empty list would let every section pass.
    expect(DROPPED.length).toBeGreaterThan(0);
    expect(DROPPED).toContain("posts");
    for (const section of EXPORT_SECTIONS) {
      expect(DROPPED, section.key).not.toContain(section.table);
    }
  });

  it("E7 every read is filtered by the caller's id, on the column the table keys users by", async () => {
    const { calls } = await exportOf({}, EXPORT_SECTIONS);
    expect(calls.length).toBe(EXPORT_SECTIONS.length);
    for (const call of calls) {
      expect(call.userId, call.table).toBe(USER);
      expect(call.filterColumn, call.table).toBe(EXPECTED_FILTER[call.table]);
    }
    expect(EXPORT_SECTIONS.map((s) => s.table).sort()).toEqual(
      Object.keys(EXPECTED_FILTER).sort()
    );
  });

  it("E8 every section pages on its table's primary key", () => {
    for (const section of EXPORT_SECTIONS) {
      expect(section.orderColumn, section.table).toBe(
        EXPECTED_ORDER[section.table]
      );
    }
  });

  it("E9 the page size does not exceed the PostgREST row cap and is the one every read uses", async () => {
    expect(EXPORT_PAGE_SIZE).toBeGreaterThan(0);
    expect(EXPORT_PAGE_SIZE).toBeLessThanOrEqual(1000);
    const { calls } = await exportOf({}, EXPORT_SECTIONS);
    for (const call of calls) expect(call.limit).toBe(EXPORT_PAGE_SIZE);
  });

  it("E13 a key selected only for paging is removed from the output; keys that are columns stay", async () => {
    const { result, calls } = await exportOf(
      {
        plaid_connections: plaidRows([1, 2]),
        chat_messages: messages(2),
        email_confirmation_sends: [
          {
            user_id: USER,
            last_sent_at: "2026-11-04T00:00:00Z",
            window_start: "2026-11-03T12:00:00Z",
            window_count: 2,
          },
          {
            user_id: OTHER,
            last_sent_at: "2026-11-04T00:00:00Z",
            window_start: "2026-11-04T00:00:00Z",
            window_count: 1,
          },
        ],
      },
      EXPORT_SECTIONS
    );
    expect(result.status).toBe(200);

    expect(callsFor(calls, "plaid_connections")[0].select).toBe(
      "institution_name, status, item_id, id"
    );
    for (const row of result.body.plaid_connections as ExportRow[]) {
      expect(Object.keys(row)).toEqual(["institution_name", "status", "item_id"]);
    }
    for (const row of result.body.chat_messages as ExportRow[]) {
      expect(row).toHaveProperty("id");
    }

    expect(callsFor(calls, "email_confirmation_sends")[0].select).toBe(
      "last_sent_at, window_start, window_count, user_id"
    );
    expect(result.body.email_confirmation_sends).toEqual([
      {
        last_sent_at: "2026-11-04T00:00:00Z",
        window_start: "2026-11-03T12:00:00Z",
        window_count: 2,
      },
    ]);
  });
});

describe("account export: explicit column lists match the schema", () => {
  const MIGRATIONS_DIR = new URL("../../../supabase/migrations/", import.meta.url);

  /**
   * Normalizes line endings and strips SQL line comments, so a statement
   * quoted in a comment (a reversal block, an example) is not read as a
   * schema change. Every text the column computation sees goes through here.
   */
  function prepareMigrationText(raw: string): string {
    return raw
      .replace(/\r\n?/g, "\n")
      .replace(/--[^\n]*/g, "");
  }

  function readMigration(name: string): string {
    return prepareMigrationText(
      readFileSync(fileURLToPath(new URL(name, MIGRATIONS_DIR)), "utf8")
    );
  }

  const MIGRATION_FILES = readdirSync(fileURLToPath(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  /**
   * The table's columns as the given migration texts leave them, in order:
   * the CREATE TABLE's column lines, then every later ADD COLUMN / DROP
   * COLUMN on the table. Pure, so it can be run on synthetic texts.
   */
  function migrationColumnsFrom(
    table: string,
    texts: readonly string[]
  ): { columns: string[]; created: number } {
    const columns: string[] = [];
    let created = 0;
    const createHead = `create table if not exists public.${table} (`;
    const alterHead = new RegExp(
      `alter table (?:if exists )?(?:only )?public\\.${table}\\b([\\s\\S]*?);`,
      "gi"
    );
    for (const text of texts) {
      const start = text.indexOf(createHead);
      if (start !== -1) {
        created += 1;
        const end = text.indexOf("\n);", start);
        const body = text.slice(start + createHead.length, end);
        const constraint = body.indexOf("\n  constraint ");
        const columnPart = constraint === -1 ? body : body.slice(0, constraint);
        const pattern = /^ {2}([a-z_]+) /gm;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(columnPart)) !== null) columns.push(match[1]);
      }
      let alter: RegExpExecArray | null;
      alterHead.lastIndex = 0;
      while ((alter = alterHead.exec(text)) !== null) {
        const clause = /\b(add|drop) column (?:if (?:not )?exists )?([a-z_]+)/gi;
        let change: RegExpExecArray | null;
        while ((change = clause.exec(alter[1])) !== null) {
          const column = change[2].toLowerCase();
          if (change[1].toLowerCase() === "add") {
            columns.push(column);
          } else {
            const at = columns.indexOf(column);
            if (at !== -1) columns.splice(at, 1);
          }
        }
      }
    }
    return { columns, created };
  }

  /** The table's columns as the repository's migrations leave them. */
  function migrationColumns(table: string): string[] {
    const { columns, created } = migrationColumnsFrom(
      table,
      MIGRATION_FILES.map(readMigration)
    );
    expect(created, `CREATE TABLE for ${table}`).toBe(1);
    return columns;
  }

  const SYNTHETIC_CREATE =
    "create table if not exists public.users (\n" +
    "  id uuid primary key,\n" +
    "  email text not null\n" +
    ");\n";
  const SYNTHETIC_ADD_STATUS =
    "alter table public.users\n  add column status text not null default 'active';\n";

  it("E15 a drop column quoted in a comment after the real add does not remove the column", () => {
    // Read as a statement, the comment would hide a column the database has.
    const { columns } = migrationColumnsFrom("users", [
      prepareMigrationText(SYNTHETIC_CREATE),
      prepareMigrationText(
        SYNTHETIC_ADD_STATUS + "-- alter table public.users drop column status;\n"
      ),
    ]);
    expect(columns).toEqual(["id", "email", "status"]);
  });

  it("E16 an add column quoted in a comment does not add a column", () => {
    // Read as a statement, the comment would report a column the database
    // lacks, and an export selecting it would pass here and fail with 42703.
    const { columns } = migrationColumnsFrom("users", [
      prepareMigrationText(SYNTHETIC_CREATE),
      prepareMigrationText(
        SYNTHETIC_ADD_STATUS + "-- alter table public.users add column ghost text;\n"
      ),
    ]);
    expect(columns).toEqual(["id", "email", "status"]);
  });

  const EXPLICIT = ["chat_sessions", "chat_usage_reservations", "email_confirmation_sends"];

  for (const table of EXPLICIT) {
    it(`E10 ${table}: the export's columns are the table's columns minus user_id`, () => {
      const section = sectionFor(table);
      expect(section.columns).not.toBe("*");
      const exported = section.columns.split(", ");
      const schema = migrationColumns(table);
      expect(schema).toContain("user_id");
      expect(new Set(exported).size).toBe(exported.length);
      expect([...exported].sort()).toEqual(
        schema.filter((c) => c !== "user_id").sort()
      );
    });
  }

  it("E14 users: the export's columns are the table's columns, id included", () => {
    // users has no user_id; its id is the user's own id. A column added to
    // the table is exported only once someone adds it here.
    const section = sectionFor("users");
    expect(section.columns).not.toBe("*");
    const exported = section.columns.split(", ");
    const schema = migrationColumns("users");
    expect(schema).not.toContain("user_id");
    expect(schema).toContain("id");
    expect(schema).toContain("status");
    expect(new Set(exported).size).toBe(exported.length);
    expect([...exported].sort()).toEqual([...schema].sort());
  });
});

describe("account export: the production page reader", () => {
  type Call = [string, ...unknown[]];

  function fakeClient(calls: Call[]) {
    const builder = {
      select(columns: string) {
        calls.push(["select", columns]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(["eq", column, value]);
        return builder;
      },
      gt(column: string, value: unknown) {
        calls.push(["gt", column, value]);
        return builder;
      },
      gte(column: string, value: unknown) {
        calls.push(["gte", column, value]);
        return builder;
      },
      order(column: string, options: unknown) {
        calls.push(["order", column, options]);
        return builder;
      },
      limit(count: number) {
        calls.push(["limit", count]);
        return builder;
      },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return {
      from(table: string) {
        calls.push(["from", table]);
        return builder;
      },
    };
  }

  const base = {
    table: "chat_messages",
    select: "*",
    filterColumn: "user_id",
    userId: USER,
    orderColumn: "id",
    limit: EXPORT_PAGE_SIZE,
  };

  it("E11 a first page filters, orders ascending and limits; a later page adds gt on the last key", async () => {
    const calls: Call[] = [];
    const read = makeSupabasePageReader(
      fakeClient(calls) as unknown as Parameters<typeof makeSupabasePageReader>[0]
    );

    await read(base);
    expect(calls).toEqual([
      ["from", "chat_messages"],
      ["select", "*"],
      ["eq", "user_id", USER],
      ["order", "id", { ascending: true }],
      ["limit", EXPORT_PAGE_SIZE],
    ]);

    calls.length = 0;
    await read({ ...base, afterKey: uuidFor(7) });
    expect(calls).toEqual([
      ["from", "chat_messages"],
      ["select", "*"],
      ["eq", "user_id", USER],
      ["gt", "id", uuidFor(7)],
      ["order", "id", { ascending: true }],
      ["limit", EXPORT_PAGE_SIZE],
    ]);
  });
});

describe("account export route: identity", () => {
  const ROUTE = readFileSync(
    fileURLToPath(new URL("../../app/api/account/export/route.ts", import.meta.url)),
    "utf8"
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("E12 the caller's id comes from the verified token, before any client is built, and nowhere else", () => {
    const auth = ROUTE.indexOf(
      "const authUserId = await getAuthenticatedUserIdFromRequest(request);"
    );
    const unauthorized = ROUTE.indexOf("if (!authUserId)");
    const admin = ROUTE.indexOf("createAdminClient()");
    expect(auth).toBeGreaterThan(-1);
    expect(unauthorized).toBeGreaterThan(auth);
    expect(admin).toBeGreaterThan(unauthorized);
    expect(ROUTE.slice(unauthorized, admin)).toContain("status: 401");

    expect(ROUTE).toMatch(/buildAccountExport\(\s*authUserId,/);
    expect(ROUTE).not.toMatch(/request\.(json|text|formData|body)|searchParams/);

    // One call, with exactly the id and the reader and no options: a third
    // argument could replace the sections, the page size or the clock.
    expect(ROUTE.split("buildAccountExport(").length - 1).toBe(1);
    expect(ROUTE).toMatch(
      /buildAccountExport\(\s*authUserId,\s*makeSupabasePageReader\(admin\),?\s*\)/
    );
    expect(ROUTE).not.toMatch(/\b(sections|pageSize|EXPORT_SECTIONS)\b/);
  });
});
