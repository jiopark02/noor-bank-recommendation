import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildAccountExport,
  EXPORT_SECTIONS,
  type ExportIdentity,
  type ExportRow,
  type PageRequest,
  type ReadPage,
} from "../accountExport";

/**
 * The two export sections that are not read by the caller's id alone: joint
 * goals the caller created, and invites made for the caller's confirmed
 * address. Executed through buildAccountExport with a reader that applies
 * every filter a page asks for (filterValue and the fixed equality), the way
 * the production reader asks PostgREST to.
 *
 * Mutations and the test each one turns red:
 *   the kind = 'joint' equality dropped, or the section read by household_id -> T-X1
 *   created_by or owner_user_id exported, or a goals column left out        -> T-X1
 *   the received section read without a confirmed address                   -> T-X3
 *   the address not trimmed or lowercased before the read                   -> T-X3
 *   the received section read by the caller's id                            -> T-X3
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOUSEHOLD = "33333333-3333-4333-8333-333333333333";

function uuid(i: number): string {
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

/** A reader that keeps the rows matching every equality the page asks for. */
function filteringReader(rowsByTable: Record<string, ExportRow[]>) {
  const calls: PageRequest[] = [];
  const readPage: ReadPage = async (request) => {
    calls.push({ ...request });
    const rows = (rowsByTable[request.table] ?? [])
      .filter((r) => r[request.filterColumn] === request.filterValue)
      .filter((r) => !request.extraEq || r[request.extraEq.column] === request.extraEq.value)
      .filter((r) => request.afterKey === undefined || String(r[request.orderColumn]) > String(request.afterKey))
      .sort((a, b) => (String(a[request.orderColumn]) < String(b[request.orderColumn]) ? -1 : 1))
      .slice(0, request.limit)
      .map((r) => {
        const out: ExportRow = {};
        for (const c of request.select.split(",").map((s) => s.trim())) out[c] = r[c];
        return out;
      });
    return { data: rows, error: null };
  };
  return { readPage, calls };
}

function goalsColumns(): string[] {
  const file = path.resolve(
    __dirname,
    "../../../supabase/migrations/20261108120000_create_households_and_goals.sql"
  );
  const sql = readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
  const head = "create table if not exists public.goals (";
  const start = sql.indexOf(head);
  expect(start).toBeGreaterThan(-1);
  let block = sql.slice(start + head.length, sql.indexOf("\n);", start));
  const constraint = block.indexOf("\n  constraint ");
  if (constraint !== -1) block = block.slice(0, constraint);
  const columns: string[] = [];
  const re = /^ {2}([a-z_]+) /gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) columns.push(m[1]);
  return columns;
}

const UNCONFIRMED: ExportIdentity = { id: USER, email: "person@example.test", emailConfirmed: false };
const CONFIRMED: ExportIdentity = { id: USER, email: " Person@Example.TEST ", emailConfirmed: true };

describe("export: joint goals the caller created", () => {
  const GOALS: ExportRow[] = [
    {
      id: uuid(1), kind: "joint", owner_user_id: null, household_id: HOUSEHOLD, created_by: USER,
      target_amount_cents: 100, target_date: null, monthly_amount_cents: null, status: "active",
      created_at: "t", updated_at: "t",
    },
    {
      id: uuid(2), kind: "joint", owner_user_id: null, household_id: HOUSEHOLD, created_by: OTHER,
      target_amount_cents: 200, target_date: null, monthly_amount_cents: null, status: "active",
      created_at: "t", updated_at: "t",
    },
    {
      id: uuid(3), kind: "personal", owner_user_id: USER, household_id: null, created_by: USER,
      target_amount_cents: 300, target_date: null, monthly_amount_cents: null, status: "active",
      created_at: "t", updated_at: "t",
    },
  ];

  it("T-X1 joint_goals_created holds only joint goals the caller created; goals still holds only personal ones", async () => {
    const fake = filteringReader({ goals: GOALS });
    const result = await buildAccountExport(UNCONFIRMED, fake.readPage);
    expect(result.status).toBe(200);
    const joint = result.body.joint_goals_created as ExportRow[];
    expect(joint.map((r) => r.id)).toEqual([uuid(1)]);
    expect(joint[0].household_id).toBe(HOUSEHOLD);
    const personal = result.body.goals as ExportRow[];
    expect(personal.map((r) => r.id)).toEqual([uuid(3)]);

    const call = fake.calls.find((c) => c.table === "goals" && c.filterColumn === "created_by");
    expect(call?.filterValue).toBe(USER);
    expect(call?.extraEq).toEqual({ column: "kind", value: "joint" });
  });

  it("T-X1 the section's columns are the goals table's columns minus created_by and owner_user_id", () => {
    const section = EXPORT_SECTIONS.find((s) => s.key === "joint_goals_created");
    expect(section?.table).toBe("goals");
    const exported = String(section?.columns).split(", ");
    const schema = goalsColumns();
    expect(schema).toContain("created_by");
    expect(schema).toContain("owner_user_id");
    expect(new Set(exported).size).toBe(exported.length);
    expect([...exported].sort()).toEqual(
      schema.filter((c) => c !== "created_by" && c !== "owner_user_id").sort()
    );
  });
});

describe("export: invites made for the caller's address", () => {
  const INVITES: ExportRow[] = [
    { id: uuid(1), household_id: HOUSEHOLD, invited_by: OTHER, invitee_email: "person@example.test", token_hash: "a".repeat(64), created_at: "t", expires_at: "t" },
    { id: uuid(2), household_id: HOUSEHOLD, invited_by: OTHER, invitee_email: "someone.else@example.test", token_hash: "b".repeat(64), created_at: "t", expires_at: "t" },
    { id: uuid(3), household_id: HOUSEHOLD, invited_by: USER, invitee_email: "someone.else@example.test", token_hash: "c".repeat(64), created_at: "t", expires_at: "t" },
  ];

  function receivedCalls(calls: PageRequest[]): PageRequest[] {
    return calls.filter((c) => c.table === "household_invites" && c.filterColumn === "invitee_email");
  }

  it.each<[string, ExportIdentity]>([
    ["an unconfirmed address", UNCONFIRMED],
    ["no address", { id: USER, email: null, emailConfirmed: true }],
    ["a confirmed value that is not an address", { id: USER, email: "not an address", emailConfirmed: true }],
  ])("T-X3 %s: the section is not read and comes out empty", async (_label, identity) => {
    const fake = filteringReader({ household_invites: INVITES });
    const result = await buildAccountExport(identity, fake.readPage);
    expect(result.status).toBe(200);
    expect(receivedCalls(fake.calls)).toEqual([]);
    expect(result.body.household_invites_received).toEqual([]);
  });

  it("T-X3 a confirmed address is read trimmed and lowercased, and only invites for it come out", async () => {
    const fake = filteringReader({ household_invites: INVITES });
    const result = await buildAccountExport(CONFIRMED, fake.readPage);
    expect(result.status).toBe(200);
    const calls = receivedCalls(fake.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].filterValue).toBe("person@example.test");
    expect(calls[0].userId).toBe(USER);
    const received = result.body.household_invites_received as ExportRow[];
    expect(received.map((r) => r.id)).toEqual([uuid(1)]);
    // The invites the caller sent stay where they were.
    expect((result.body.household_invites as ExportRow[]).map((r) => r.id)).toEqual([uuid(3)]);
  });
});
