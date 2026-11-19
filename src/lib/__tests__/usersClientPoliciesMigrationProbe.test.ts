import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Source probe of the migration that leaves client roles with SELECT alone on
 * public.users: no write policy and no other table privilege. It cannot run
 * the SQL; it holds the lines whose loss would keep a write policy, take
 * SELECT away from a client role, drop or replace the SELECT policy, touch
 * service_role, or weaken a check in either DO block. It also holds that every
 * check fails by raising an exception that nothing catches, so a failed check
 * rolls back the whole file rather than printing a message and committing, and
 * that the opening block runs before anything is changed. Whether the file is
 * applied, and whether its DO blocks passed, is live state that only the
 * database can answer.
 *
 * SQL line comments are stripped from `sql`, so the header (which quotes the
 * reversing statements) cannot stand in for a statement or trip a negative
 * check. The reversal itself is read from `raw`.
 */

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261119120000_restrict_client_policies_and_privileges_on_users.sql"
);

const raw = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");

const DROPS = [
  "drop policy if exists users_update_own on public.users;",
  'drop policy if exists "Users can update their own data" on public.users;',
];

const REVOKE = "revoke all on table public.users from public, anon, authenticated;";
const GRANT = "grant select on table public.users to anon, authenticated;";

const EXPECTED_QUAL = "v_expected_qual constant text := '(auth.uid() = id)';";

function occurrences(needle: string, text: string = sql): number {
  return text.split(needle).length - 1;
}

function matches(pattern: RegExp, text: string = sql): number {
  return (text.match(pattern) || []).length;
}

const DO_START = "do $$";
const DO_END = "end\n$$;";

/** The DO blocks, in file order. */
function doBlocks(): { start: number; end: number; body: string }[] {
  const blocks: { start: number; end: number; body: string }[] = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf(DO_START, from);
    if (start === -1) break;
    const end = sql.indexOf(DO_END, start);
    if (end === -1) throw new Error("unterminated DO block");
    blocks.push({ start, end, body: sql.slice(start, end) });
    from = end + DO_END.length;
  }
  return blocks;
}

const SNAPSHOT_START = "select jsonb_build_object(";
const SNAPSHOT_END = "where c.oid = v_survey;";

/**
 * The one statement in `body` that reads the state of survey_responses, from
 * its SELECT to the end of its WHERE. Throws unless there is exactly one.
 */
function snapshotStatement(body: string): string {
  if (occurrences(SNAPSHOT_START, body) !== 1 || occurrences(SNAPSHOT_END, body) !== 1) {
    throw new Error("expected exactly one snapshot statement in the block");
  }
  const start = body.indexOf(SNAPSHOT_START);
  const end = body.indexOf(SNAPSHOT_END, start);
  if (end === -1) throw new Error("snapshot statement has no end");
  return body.slice(start, end + SNAPSHOT_END.length);
}

// The privileges the closing block requires each client role not to hold,
// before MAINTAIN is appended on PostgreSQL 17 or later.
const DENIED = ["DELETE", "INSERT", "REFERENCES", "TRIGGER", "TRUNCATE", "UPDATE"];

// The privileges the closing block requires service_role to hold.
const SERVICE_ROLE_REQUIRED = ["DELETE", "INSERT", "SELECT", "UPDATE"];

// The one `v_denied text[] := array[ ... ];` declaration.
const DENIED_DECLARATION = /\bv_denied\s+text\[\]\s*:=\s*array\s*\[([^\]]*)\]\s*;/i;

// The array the service_role check walks: `unnest(array[ ... ]) as
// p(privilege)` directly followed by `where not has_table_privilege(
// 'service_role', ...`.
const SERVICE_ROLE_ARRAY =
  /\bunnest\s*\(\s*array\s*\[([^\]]*)\]\s*\)\s*as\s+p\s*\(\s*privilege\s*\)\s*where\s+not\s+has_table_privilege\s*\(\s*'service_role'/i;

/**
 * The privilege names in the array literal that `anchor` captures as its
 * first group, upper-cased and sorted. Throws when the anchor matches no place
 * or more than one, or when an element is not a single-quoted word, so an
 * expression cannot hide a privilege from the comparison.
 */
function quotedArray(anchor: RegExp): string[] {
  const count = matches(new RegExp(anchor.source, "gi"));
  const found = anchor.exec(sql);
  if (count !== 1 || !found) {
    throw new Error(`expected one match of ${anchor.source}, found ${count}`);
  }
  return found[1]
    .split(",")
    .map((element) => {
      const literal = /^'([A-Za-z]+)'$/.exec(element.trim());
      if (!literal) {
        throw new Error(`array element is not a quoted privilege name: ${element.trim()}`);
      }
      return literal[1].toUpperCase();
    })
    .sort();
}

describe("public.users: client policy and privilege migration", () => {
  it("has an opening and a closing DO block", () => {
    expect(doBlocks().length).toBe(2);
  });

  it("drops the update policy under both the repository and the live name, and nothing else", () => {
    for (const drop of DROPS) {
      expect(occurrences(drop)).toBe(1);
    }
    expect(matches(/\bdrop\b/gi)).toBe(DROPS.length);
  });

  it("keeps the select policy, creates none and alters none", () => {
    // Any drop of the select policy under either name, whatever the case,
    // quoting, schema or IF EXISTS, within one statement.
    expect(matches(/\bdrop\s+policy\b[^;]*(select_own|view\s+their\s+own)/gi)).toBe(0);
    expect(matches(/\b(create|alter)\s+policy\b/gi)).toBe(0);
    expect(matches(/\balter\s+table\b/gi)).toBe(0);
  });

  it("revokes everything from PUBLIC, anon and authenticated, then grants SELECT back to both", () => {
    expect(occurrences(REVOKE)).toBe(1);
    expect(occurrences(GRANT)).toBe(1);
    expect(sql.indexOf(GRANT)).toBeGreaterThan(sql.indexOf(REVOKE));
    expect(matches(/\bgrant\b/gi)).toBe(1);
    expect(matches(/\brevoke\b/gi)).toBe(1);
  });

  it("names service_role in no revoke or grant, and survey_responses in no statement that changes it", () => {
    expect(matches(/\b(revoke|grant)\b[^;]*service_role/gi)).toBe(0);
    expect(matches(/\b(revoke|grant|drop|create|alter)\b[^;]*survey_responses/gi)).toBe(0);
  });

  it("changes nothing before the opening block has passed", () => {
    const [opening, closing] = doBlocks();
    const firstChange = sql.indexOf(DROPS[0]);
    expect(firstChange).toBeGreaterThan(opening.end);
    for (const statement of DROPS.concat([REVOKE, GRANT])) {
      expect(sql.indexOf(statement)).toBeGreaterThan(opening.end);
      expect(sql.indexOf(statement)).toBeLessThan(closing.start);
    }
    expect(matches(/\b(drop|revoke|grant)\b/gi, opening.body)).toBe(0);
    expect(matches(/\b(drop|revoke|grant)\b/gi, closing.body)).toBe(0);
  });

  it("stops in the opening block on RLS off, an unknown kind of policy, or a select policy that is not the expected one", () => {
    const [opening] = doBlocks();
    expect(opening.body).toContain(
      "select c.relrowsecurity into v_rls from pg_class c where c.oid = v_users;"
    );
    expect(opening.body).toContain("if v_rls is distinct from true then");
    expect(opening.body).toContain("and p.polcmd not in ('r', 'w');");
    expect(opening.body).toContain(EXPECTED_QUAL);
    expect(opening.body).toContain(
      "select count(*) filter (where p.polcmd = 'r'),\n" +
        "         count(*) filter (\n" +
        "           where p.polcmd = 'r'\n" +
        "             and p.polpermissive\n" +
        "             and pg_get_expr(p.polqual, p.polrelid) = v_expected_qual\n" +
        "         ),"
    );
    expect(opening.body).toContain("if v_select_count <> 1 or v_matching <> 1 then");
  });

  it("checks both client roles hold SELECT and no other privilege, table or column", () => {
    const [, closing] = doBlocks();
    expect(closing.body).toContain("foreach v_role in array array['anon', 'authenticated'] loop");
    expect(closing.body).toContain(
      "from unnest(v_denied) as p(privilege)\n     where has_table_privilege(v_role, v_users, p.privilege);"
    );
    expect(closing.body).toContain(
      "has_any_column_privilege(v_role, v_users, 'INSERT,UPDATE,REFERENCES')"
    );
    expect(closing.body).toContain("if not has_table_privilege(v_role, v_users, 'SELECT') then");
    // The exact set, not each name somewhere in the file: INSERT, UPDATE and
    // DELETE also appear in the service_role check.
    expect(quotedArray(DENIED_DECLARATION)).toEqual(DENIED);
    // The declaration is the only place the list is set, apart from MAINTAIN
    // being appended on versions that have it.
    expect(matches(/\bv_denied\s*:=/gi)).toBe(1);
    expect(matches(/\binto\s+v_denied\b/gi)).toBe(0);
    expect(occurrences("v_denied := array_append(v_denied, 'MAINTAIN');")).toBe(1);
    expect(sql).toContain("current_setting('server_version_num')::integer >= 170000");
  });

  it("checks every role a client role is a member of, whether or not the membership inherits", () => {
    const [, closing] = doBlocks();
    // Both client roles, every role but the client role itself, by
    // membership of any kind: a narrower test (inherited privileges only)
    // misses a role the client can switch to.
    expect(closing.body).toContain(
      "        from unnest(array['anon', 'authenticated']) as k(client)\n" +
        "        join pg_roles r\n" +
        "          on r.rolname <> k.client\n" +
        "         and pg_has_role(k.client::name, r.oid, 'MEMBER')\n" +
        "    ) m"
    );
    expect(matches(/\bpg_has_role\s*\(/gi)).toBe(1);
    // The same denied list as the client roles themselves, MAINTAIN included
    // where it is appended, and the same column privileges.
    expect(closing.body).toContain(
      "from unnest(v_denied) as p(privilege)\n" +
        "                 where has_table_privilege(r.oid, v_users, p.privilege)),"
    );
    expect(closing.body).toContain(
      "when has_any_column_privilege(r.oid, v_users, 'INSERT,UPDATE,REFERENCES')"
    );
    // Only a role that holds one of them is reported, so a membership in a
    // role with no privilege on the table passes.
    expect(closing.body).toContain("   where m.held <> '';");
    // The message names the client role, the role it reaches and what that
    // role holds.
    expect(closing.body).toContain("format('%s through %s: %s', m.client, m.via, m.held),");
    // It runs after MAINTAIN has been appended to the list it walks.
    expect(closing.body.indexOf("pg_has_role(")).toBeGreaterThan(
      closing.body.indexOf("v_denied := array_append(v_denied, 'MAINTAIN');")
    );
  });

  it("checks that no column carries an explicit ACL entry for PUBLIC, anon or authenticated", () => {
    const [, closing] = doBlocks();
    expect(closing.body).toContain(
      "     and exists (\n" +
        "           select 1\n" +
        "             from aclexplode(a.attacl) x\n" +
        "            where x.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid)\n" +
        "         );"
    );
    expect(closing.body).toContain("where a.attrelid = v_users");
  });

  it("checks PUBLIC, RLS and service_role", () => {
    const [, closing] = doBlocks();
    expect(closing.body).toContain("where c.oid = v_users\n       and a.grantee = 0");
    expect(closing.body).toContain(
      "select c.relrowsecurity into v_rls from pg_class c where c.oid = v_users;"
    );
    expect(closing.body).toContain("if v_rls is distinct from true then");
    expect(closing.body).toContain(
      "where not has_table_privilege('service_role', v_users, p.privilege);"
    );
    // The exact set the service_role check walks: a name dropped from it is
    // no longer checked, and a name added is one this file must not require.
    expect(quotedArray(SERVICE_ROLE_ARRAY)).toEqual(SERVICE_ROLE_REQUIRED);
  });

  it("checks the one remaining policy by property, not by name", () => {
    const [, closing] = doBlocks();
    expect(closing.body).toContain(EXPECTED_QUAL);
    // The expected text is declared once per block and assigned nowhere else.
    expect(occurrences(EXPECTED_QUAL)).toBe(2);
    expect(matches(/\bv_expected_qual\s*:=/gi)).toBe(0);
    expect(matches(/\bv_expected_qual\s+constant\s+text\s*:=/gi)).toBe(2);
    expect(closing.body).toContain(
      "select count(*),\n" +
        "         count(*) filter (\n" +
        "           where p.polcmd = 'r'\n" +
        "             and p.polpermissive\n" +
        "             and pg_get_expr(p.polqual, p.polrelid) = v_expected_qual\n" +
        "             and p.polwithcheck is null\n" +
        "         ),"
    );
    expect(closing.body).toContain("if v_policy_count <> 1 or v_matching <> 1 then");
    expect(sql).not.toContain("select_own");
    expect(matches(/view\s+their\s+own/gi)).toBe(0);
  });

  it("reads survey_responses with the same statement before and after, covering flags, ACLs and policies", () => {
    const [opening, closing] = doBlocks();
    const before = snapshotStatement(opening.body);
    const after = snapshotStatement(closing.body);
    expect(after).toEqual(before);
    for (const part of [
      "c.relrowsecurity",
      "c.relforcerowsecurity",
      "c.relacl::text",
      "p.polname::text",
      "p.polcmd::text",
      "p.polpermissive",
      "p.polroles::text",
      "pg_get_expr(p.polqual, p.polrelid)",
      "pg_get_expr(p.polwithcheck, p.polrelid)",
      "a.attacl::text",
      "into v_snapshot",
    ]) {
      expect(before).toContain(part);
    }
    expect(occurrences("v_survey regclass := 'public.survey_responses'::regclass;")).toBe(2);
  });

  it("records the survey_responses reading before the change and compares it after", () => {
    const [opening, closing] = doBlocks();
    const record = "perform set_config('noor.survey_responses_before', v_snapshot, true);";
    expect(occurrences(record, opening.body)).toBe(1);
    expect(opening.body.indexOf(record)).toBeGreaterThan(opening.body.indexOf(SNAPSHOT_END));
    expect(opening.body).toContain("if v_snapshot is null then");
    expect(matches(/\bset_config\b/gi)).toBe(1);

    const read =
      "v_before := nullif(current_setting('noor.survey_responses_before', true), '');";
    expect(occurrences(read, closing.body)).toBe(1);
    expect(closing.body.indexOf(read)).toBeGreaterThan(closing.body.indexOf(SNAPSHOT_END));
    expect(closing.body).toContain(
      "if v_before is null or v_snapshot is distinct from v_before then"
    );
    // Neither value is assigned anywhere else.
    expect(matches(/\bv_before\s*:=/gi)).toBe(1);
    expect(matches(/\bv_snapshot\s*:=/gi)).toBe(0);
    expect(matches(/\binto\s+v_snapshot\b/gi)).toBe(2);
  });

  it("fails every check with an uncaught exception, so a failed check rolls the file back", () => {
    // One per `if <condition> then raise exception` check, both DO blocks
    // together. Change it together with the blocks.
    const CHECKS_IN_DO_BLOCKS = 14;
    // Each check's `then` is followed directly by its raise: a raise that is
    // removed, downgraded or moved away from its check lowers this count.
    expect(matches(/\bthen\s+raise\s+exception\b/gi)).toBe(CHECKS_IN_DO_BLOCKS);
    expect(matches(/\braise\s+exception\b/gi)).toBe(CHECKS_IN_DO_BLOCKS);
    // A raise at any other level only reports and lets the file commit.
    expect(matches(/\braise\s+(notice|warning|info|log|debug)\b/gi)).toBe(0);
    expect(matches(/\braise\b/gi)).toBe(CHECKS_IN_DO_BLOCKS);
    // An exception handler in a DO block would catch the raise and let the
    // file commit.
    expect(matches(/\bexception\s+when\b/gi)).toBe(0);
  });

  it("runs in one transaction with a lock timeout and an empty search_path", () => {
    const trimmed = sql.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
    expect(matches(/\b(begin|commit|rollback)\s*;/gi)).toBe(2);
    expect(occurrences("set local lock_timeout = '5s';")).toBe(1);
    expect(occurrences("set local search_path = '';")).toBe(1);
    const [opening] = doBlocks();
    expect(sql.indexOf("set local search_path = '';")).toBeLessThan(opening.start);
  });

  it("carries the reversal in its header", () => {
    expect(raw).toContain(
      "--   begin;\n" +
        '--   create policy "Users can update their own data"\n' +
        "--     on public.users\n" +
        "--     for update\n" +
        "--     using (auth.uid() = id);\n" +
        "--   create policy users_update_own\n" +
        "--     on public.users\n" +
        "--     for update\n" +
        "--     using (auth.uid() = id)\n" +
        "--     with check (auth.uid() = id);\n" +
        "--   grant maintain, references, trigger\n" +
        "--     on table public.users to anon, authenticated;\n" +
        "--   commit;\n"
    );
  });
});
