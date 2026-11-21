import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildAccountExport, EXPORT_SECTIONS, type ReadPage } from "../accountExport";

/**
 * The household_invites export section. It is not in accountExport.test.ts's
 * E10 list, because its columns are the table's columns minus the filter
 * column and minus token_hash: the hash names the invite to the database and
 * is nothing the user entered.
 *
 * Mutations and the test each one turns red:
 *   token_hash added to the section's columns                     -> T-E2
 *   a column added to the table and not to the export, or removed  -> T-E2
 *   the section read by household_id instead of invited_by        -> T-E2
 *   token_hash, invited_by or household_id exported from the
 *     invites made for the user                                   -> T-E3
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261120120000_household_invites_and_membership_changes.sql"
);

function tableColumns(table: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/--[^\n]*/g, "");
  const head = `create table if not exists public.${table} (`;
  const start = sql.indexOf(head);
  expect(start, table).toBeGreaterThan(-1);
  let block = sql.slice(start + head.length, sql.indexOf("\n);", start));
  const constraint = block.indexOf("\n  constraint ");
  if (constraint !== -1) block = block.slice(0, constraint);
  const columns: string[] = [];
  const re = /^ {2}([a-z_]+) /gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) columns.push(m[1]);
  return columns;
}

describe("household invites export", () => {
  it("T-E2 exports every household_invites column but invited_by and token_hash, by invited_by", () => {
    const section = EXPORT_SECTIONS.find((s) => s.table === "household_invites");
    expect(section).toBeDefined();
    expect(section?.key).toBe("household_invites");
    expect(section?.filterColumn).toBe("invited_by");
    expect(section?.orderColumn).toBe("id");
    const exported = String(section?.columns).split(", ");
    expect(exported).not.toContain("token_hash");
    const schema = tableColumns("household_invites");
    expect(schema).toContain("token_hash");
    expect(schema).toContain("invited_by");
    expect([...exported].sort()).toEqual(
      schema.filter((c) => c !== "invited_by" && c !== "token_hash").sort()
    );
  });

  it("T-E3 the invites made for the user carry no token hash, no sender and no sender's household", async () => {
    const section = EXPORT_SECTIONS.find((s) => s.key === "household_invites_received");
    expect(section?.table).toBe("household_invites");
    expect(section?.filterColumn).toBe("invitee_email");
    expect(section?.filterBy).toBe("confirmed_email");
    const exported = String(section?.columns).split(", ");
    const schema = tableColumns("household_invites");
    expect([...exported].sort()).toEqual(
      schema
        .filter((c) => c !== "invited_by" && c !== "token_hash" && c !== "household_id")
        .sort()
    );

    const HASH = "d".repeat(64);
    const SENDER = "sentinel-sender-id-61";
    const SENDER_HOUSEHOLD = "sentinel-sender-household-62";
    const readPage: ReadPage = async (request) => {
      if (request.table !== "household_invites" || request.filterColumn !== "invitee_email") {
        return { data: [], error: null };
      }
      const row: Record<string, unknown> = {
        id: "00000000-0000-4000-8000-000000000001",
        household_id: SENDER_HOUSEHOLD,
        invited_by: SENDER,
        invitee_email: request.filterValue,
        token_hash: HASH,
        created_at: "t",
        expires_at: "t",
      };
      const out: Record<string, unknown> = {};
      for (const c of request.select.split(",").map((s) => s.trim())) out[c] = row[c];
      return { data: [out], error: null };
    };
    const result = await buildAccountExport(
      { id: "sentinel-user-63", email: "person@example.test", emailConfirmed: true },
      readPage
    );
    expect(result.status).toBe(200);
    expect((result.body.household_invites_received as unknown[]).length).toBe(1);
    const text = JSON.stringify(result.body);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain(SENDER);
    expect(text).not.toContain(SENDER_HOUSEHOLD);
  });
});
