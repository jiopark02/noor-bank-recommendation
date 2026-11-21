import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Every query on plaid_connections in the application source, pinned with its
 * file, enclosing function, operation and filters.
 *
 * plaid_connections holds each user's bank connections and is read through
 * the service-role client, which bypasses RLS, so the user_id filter in the
 * query is the access-control boundary. This probe fails when a query is
 * added, removed or loses a filter, so a new read of another person's
 * connections cannot arrive unnoticed. The one query without a user_id
 * filter reads by item_id for signature-verified Plaid webhooks and takes the
 * owner from the row.
 *
 * It reads source text and executes nothing. It does not prove the filter
 * value comes from a verified token; it pins the variable each query passes,
 * so a change of that variable shows up here. It reads the chain from the
 * .from() call to the first semicolon, so a filter added later through a
 * query variable (the optional .neq in getActivePlaidConnectionByInstitution)
 * is not in the record; such a filter can only narrow the query.
 *
 * The table name split so this file never matches itself.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const TABLE = ["plaid", "connections"].join("_");
const FROM = `.from("${TABLE}")`;

type Site = {
  file: string;
  fn: string;
  op: string;
  filters: string[];
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The name of the last function declared before `index`. */
function enclosingFunction(source: string, index: number): string {
  const before = source.slice(0, index);
  const re = /(?:function\s+([A-Za-z0-9_]+)|export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+))/g;
  let name = "<none>";
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) name = m[1] ?? m[2];
  return name;
}

function sites(): Site[] {
  const out: Site[] = [];
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    let from = source.indexOf(FROM);
    while (from !== -1) {
      const end = source.indexOf(";", from);
      const chain = source.slice(from + FROM.length, end).replace(/\/\/[^\n]*/g, "");
      const op = /^\s*\.(select|insert|update|upsert|delete)\(/.exec(chain)?.[1] ?? "<unknown>";
      const filters: string[] = [];
      const eq = /\.eq\(\s*"([a-z_]+)"\s*,\s*([^)]+?)\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = eq.exec(chain)) !== null) filters.push(`${m[1]}=${m[2]}`);
      // Any other filter method is recorded by name, so it cannot slip past.
      const other = /\.(neq|in|or|filter|match|not|like|ilike|is|gt|gte|lt|lte|contains)\(/g;
      while ((m = other.exec(chain)) !== null) filters.push(`.${m[1]}()`);
      if (op === "insert") {
        const owner = /\buser_id:\s*([A-Za-z0-9_.]+)/.exec(chain);
        filters.push(`insert user_id=${owner ? owner[1] : "<missing>"}`);
      }
      out.push({
        file: path.relative(SRC, file).split(path.sep).join("/"),
        fn: enclosingFunction(source, from),
        op,
        filters,
      });
      from = source.indexOf(FROM, from + FROM.length);
    }
  }
  return out.sort((a, b) =>
    `${a.file}|${a.fn}|${a.op}|${a.filters.join(",")}`.localeCompare(
      `${b.file}|${b.fn}|${b.op}|${b.filters.join(",")}`
    )
  );
}

const EXPECTED: Site[] = [
  { file: "app/api/plaid/connections/route.ts", fn: "readConnections", op: "select", filters: ["user_id=authUserId"] },
  { file: "lib/plaidApiUtils.ts", fn: "countPlaidConnections", op: "select", filters: ["user_id=userId"] },
  { file: "lib/plaidApiUtils.ts", fn: "deletePlaidConnection", op: "delete", filters: ["user_id=userId", "item_id=itemId"] },
  { file: "lib/plaidApiUtils.ts", fn: "getActivePlaidConnectionByInstitution", op: "select", filters: ["user_id=userId", "institution_id=institutionId", 'status="active"'] },
  { file: "lib/plaidApiUtils.ts", fn: "getAllPlaidConnections", op: "select", filters: ["user_id=userId"] },
  { file: "lib/plaidApiUtils.ts", fn: "getPlaidConnectionByItemId", op: "select", filters: ["user_id=userId", "item_id=itemId"] },
  // The one cross-user read: signature-verified webhooks, owner taken from the row.
  { file: "lib/plaidApiUtils.ts", fn: "getPlaidConnectionsByItemIdAcrossUsers", op: "select", filters: ["item_id=itemId"] },
  { file: "lib/plaidApiUtils.ts", fn: "getRevocableConnectionByItemId", op: "select", filters: ["user_id=userId", "item_id=itemId"] },
  { file: "lib/plaidApiUtils.ts", fn: "getRevocableConnections", op: "select", filters: ["user_id=userId"] },
  { file: "lib/plaidApiUtils.ts", fn: "storePlaidConnection", op: "insert", filters: ["insert user_id=userId"] },
  { file: "lib/plaidChatState.ts", fn: "getPlaidChatState", op: "select", filters: ["user_id=userId"] },
];

describe("plaid_connections queries", () => {
  it("every query is in the recorded list, with its filters", () => {
    expect(sites()).toEqual(EXPECTED);
  });

  it("every query but the webhook's item_id read filters by user_id or inserts the caller's user_id", () => {
    const crossUser = sites().filter(
      (s) =>
        !s.filters.some((f) => f.startsWith("user_id=") || f.startsWith("insert user_id="))
    );
    expect(crossUser).toEqual([
      {
        file: "lib/plaidApiUtils.ts",
        fn: "getPlaidConnectionsByItemIdAcrossUsers",
        op: "select",
        filters: ["item_id=itemId"],
      },
    ]);
  });

  it("the account export's dynamic read of the table filters by user_id", () => {
    // accountExport.ts reads every section through .from(request.table), so
    // the literal search above does not see it.
    const source = readFileSync(path.join(SRC, "lib/accountExport.ts"), "utf8");
    const line = source.split("\n").find((l) => l.includes(`key: "${TABLE}"`));
    expect(line).toBeDefined();
    expect(line).toContain(`table: "${TABLE}"`);
    expect(line).toContain('filterColumn: "user_id"');
    const dynamic = walk(SRC).filter((file) =>
      /\.from\(\s*[A-Za-z_][A-Za-z0-9_.]*\s*\)/.test(
        readFileSync(file, "utf8").replace(/(Array|Buffer|gsap)\.from\(/g, "")
      )
    );
    expect(
      dynamic.map((f) => path.relative(SRC, f).split(path.sep).join("/")).sort()
    ).toEqual(["lib/accountExport.ts"]);
  });
});
