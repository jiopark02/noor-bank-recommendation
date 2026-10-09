import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * GET /api/account/export includes the caller's llm_calls rows, and only
 * theirs.
 *
 * The select names its columns rather than using `*`, so a column added to
 * llm_calls later is not exported until someone decides it should be. Every
 * column except user_id is listed; the payload's top-level user_id already
 * carries that value.
 *
 * ⚠️ A SOURCE PROBE. It shows the query is written with the user filter and
 * the column list. It cannot show the table exists where the route runs: if it
 * does not, the whole export answers 500, by the route's existing rule that a
 * failed section fails the export. That is checked live.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/api/account/export/route.ts", import.meta.url)),
  "utf8"
).replace(/\r\n?/g, "\n");

const EXPORTED_COLUMNS =
  "id, created_at, started_at, route, attempt_index, request_model, response_model, generation_id, succeeded, http_status, error_class, finish_reason, latency_ms, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, provider_cost, has_memory_block, has_plaid_scaffold_block, has_balance_block, has_financial_snapshot_block, engine_reason_code, session_id";

describe("account export: llm_calls", () => {
  const query = (() => {
    const start = SOURCE.indexOf('.from("llm_calls")');
    expect(start, "llm_calls query not found").toBeGreaterThan(-1);
    const end = SOURCE.indexOf("\n  ]);", start);
    return SOURCE.slice(start, end);
  })();

  it("filters by the verified caller's id", () => {
    expect(query).toContain('.eq("user_id", authUserId)');
  });

  it("selects the named columns, not *", () => {
    expect(query).toContain(`"${EXPORTED_COLUMNS}"`);
    expect(query).not.toContain('select("*")');
  });

  it("leaves out user_id only", () => {
    const columns = EXPORTED_COLUMNS.split(", ");
    expect(columns).not.toContain("user_id");
    expect(columns).toContain("generation_id");
    expect(columns).toContain("engine_reason_code");
  });

  it("adds the section to the payload", () => {
    expect(SOURCE).toContain('["llm_calls", llmCallsRes]');
  });
});
