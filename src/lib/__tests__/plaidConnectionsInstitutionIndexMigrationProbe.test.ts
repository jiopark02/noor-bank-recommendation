import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that adds the unique index on a user's active
 * connections per institution. It cannot run the SQL; it holds the lines whose
 * loss would change what the index refuses, or let the file leave something
 * half-done. Whether the file is applied, and whether its DO blocks passed, is
 * live state that only the database can answer; what the index does with NULL
 * and inactive rows is checked with SQL against a database.
 *
 * The application's side of the same condition — the filter the duplicate
 * check reads with — is executed by plaidInstitutionLookupSeam.test.ts.
 *
 * SQL line comments are stripped for every statement check, so a sentence in
 * the header cannot stand in for a statement. The header is read raw, once,
 * for the order it states.
 *
 * Mutations and the test each one turns red:
 *   `unique` dropped from the index                          -> M1
 *   a column removed, added or reordered                     -> M1
 *   `status = 'active'` or the NULL test dropped from WHERE  -> M2
 *   the index built CONCURRENTLY, or the transaction removed -> M3
 *   the duplicate check before the index removed             -> M4
 *   the catalog check after the index removed                -> M5
 *   the expected condition text changed, or the comparison
 *     turned back into a search for parts of it              -> M5
 *   a grant, a policy or a row change added                  -> M6
 *   the header's deploy-order sentence removed               -> M7
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261116120000_unique_active_institution_per_user_on_plaid_connections.sql"
);

const INDEX = "plaid_connections_user_institution_active_key";

const raw = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");
/** Whitespace folded, so a re-wrapped statement still matches. */
const flat = sql.replace(/\s+/g, " ");

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The one CREATE INDEX statement, up to its semicolon. */
function createIndex(): string {
  const start = flat.indexOf("create unique index");
  expect(start).toBeGreaterThan(-1);
  const end = flat.indexOf(";", start);
  expect(end).toBeGreaterThan(start);
  return flat.slice(start, end);
}

describe("plaid_connections institution index migration", () => {
  it("M1 creates one unique index on (user_id, institution_id)", () => {
    expect(occurrences(flat, "create ")).toBe(1);
    expect(createIndex()).toContain(
      `create unique index if not exists ${INDEX} on public.plaid_connections (user_id, institution_id)`
    );
  });

  it("M2 limits the index to the rows the duplicate check reads", () => {
    expect(createIndex()).toMatch(
      /where institution_id is not null and status = 'active'$/
    );
  });

  it("M3 runs in one transaction and never builds concurrently", () => {
    expect(occurrences(flat, "begin;")).toBe(1);
    expect(occurrences(flat, "commit;")).toBe(1);
    expect(flat.indexOf("begin;")).toBeLessThan(flat.indexOf("create unique index"));
    expect(flat.indexOf("commit;")).toBeGreaterThan(flat.lastIndexOf("do $$"));
    expect(flat.toLowerCase()).not.toContain("concurrently");
  });

  it("M4 stops before the index when covered rows already share a pair", () => {
    const before = flat.slice(0, flat.indexOf("create unique index"));
    expect(occurrences(before, "do $$")).toBe(1);
    expect(before).toContain("p.institution_id is not null");
    expect(before).toContain("p.status = 'active'");
    expect(before).toContain("group by p.user_id, p.institution_id");
    expect(before).toContain("having count(*) > 1");
    expect(before).toContain("raise exception");
  });

  it("M5 checks the index in the catalog after creating it", () => {
    const after = flat.slice(flat.indexOf("create unique index"));
    expect(occurrences(after, "do $$")).toBe(1);
    expect(after).toContain("i.indisunique");
    expect(after).toContain("i.indisvalid");
    expect(after).toContain("pg_get_expr(i.indpred, i.indrelid)");
    expect(after).toContain("array['user_id', 'institution_id']::name[]");
    expect(after).toContain(`c.relname = '${INDEX}'`);
    expect(occurrences(after, "raise exception")).toBeGreaterThanOrEqual(5);
    // The condition is compared whole with the text PostgreSQL prints for it,
    // never searched for its parts: `status <> 'active'` holds every part.
    expect(after).toContain(
      "v_expected_predicate constant text := '((institution_id IS NOT NULL) AND ((status)::text = ''active''::text))';"
    );
    expect(after).toContain("if v_predicate is distinct from v_expected_predicate then");
    expect(after).not.toContain("!~");
  });

  it("M6 changes no privilege, no policy and no row", () => {
    const lower = flat.toLowerCase();
    for (const word of ["grant ", "revoke ", "policy", "delete ", "update ", "insert ", "alter ", "drop "]) {
      expect(lower, word).not.toContain(word);
    }
  });

  it("M7 states that the code handling both causes ships before the index", () => {
    const header = raw.slice(0, raw.indexOf("\nbegin;")).replace(/\n-- ?/g, " ");
    expect(header).toContain(
      "Deploy order: deploy the code that handles both causes of a unique violation"
    );
    expect(header).toContain("before applying this index");
    expect(header).toContain(`drop index if exists public.${INDEX};`);
  });
});
