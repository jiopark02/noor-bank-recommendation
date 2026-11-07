import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The decision half of GET /api/account/export — which tables are read, how
 * each is paged, and how the file is assembled. The route verifies the token,
 * builds the page reader, calls buildAccountExport and serializes the result,
 * so everything that decides anything here is reached by
 * accountExport.test.ts with an injected reader and no vi.mock.
 *
 * PAGING
 * Every section is read in pages with a keyset: rows ordered by the section's
 * unique key, the first page limited to EXPORT_PAGE_SIZE, each later page
 * asking only for keys greater than the last key of the page before it. A page
 * with fewer rows than EXPORT_PAGE_SIZE is the last one, so a section whose
 * size is an exact multiple of the page size ends on one empty read.
 *
 * Without paging, PostgREST's server-side row cap would cut a section short
 * and the file would look complete. Paging only closes that gap while
 * EXPORT_PAGE_SIZE is no larger than that cap: a cap below the page size makes
 * a full page look like a short last page, and the section is truncated again
 * just as silently.
 *
 * FAILURE
 * If any page of any section returns an error, the whole export fails rather
 * than handing back an incomplete file the user believes is complete.
 */

/** Must not exceed the PostgREST row cap of the deployment (see above). */
export const EXPORT_PAGE_SIZE = 1000;

export type ExportKeyType = "uuid" | "int8";

export type ExportSection = {
  /** The key the rows appear under in the exported file. */
  key: string;
  table: string;
  /** "*" or a comma-separated column list: exactly what the file carries. */
  columns: string;
  /** Compared with the verified caller's id. */
  filterColumn: string;
  /** A unique key of the table; the keyset pages on it. */
  orderColumn: string;
  orderKeyType: ExportKeyType;
};

/**
 * Sections whose column list is explicit leave user_id out: the file's
 * top-level user_id already carries it, and a column added to the table later
 * is not exported until someone decides it should be. The users table has no
 * user_id; its id is the user's own id, and its list carries it.
 */
export const EXPORT_SECTIONS: readonly ExportSection[] = [
  {
    key: "users",
    table: "users",
    columns: "id, email, first_name, last_name, raw_user_meta_data, created_at, updated_at, status",
    filterColumn: "id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  { key: "survey_responses", table: "survey_responses", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  {
    key: "chat_sessions",
    table: "chat_sessions",
    columns:
      "id, title, started_at, ended_at, last_message_at, message_count, summarized, facts_extracted, created_at, updated_at",
    filterColumn: "user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  { key: "chat_messages", table: "chat_messages", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  { key: "chat_summaries", table: "chat_summaries", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  { key: "user_facts", table: "user_facts", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  // The stored bank credential is never selected; only these three columns.
  { key: "plaid_connections", table: "plaid_connections", columns: "institution_name, status, item_id", filterColumn: "user_id", orderColumn: "id", orderKeyType: "int8" },
  {
    key: "llm_calls",
    table: "llm_calls",
    columns:
      "id, created_at, started_at, route, attempt_index, request_model, response_model, generation_id, succeeded, http_status, error_class, finish_reason, latency_ms, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, provider_cost, has_memory_block, has_plaid_scaffold_block, has_balance_block, has_financial_snapshot_block, engine_reason_code, session_id",
    filterColumn: "user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  {
    key: "chat_usage_reservations",
    table: "chat_usage_reservations",
    columns: "id, created_at, mode, hold_cost, settled_cost, attempts, settled_at",
    filterColumn: "user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // One row per user, keyed by user_id, which the output leaves out.
  {
    key: "email_confirmation_sends",
    table: "email_confirmation_sends",
    columns: "last_sent_at, window_start, window_count",
    filterColumn: "user_id",
    orderColumn: "user_id",
    orderKeyType: "uuid",
  },
];

export type ExportRow = Record<string, unknown>;

export type PageRequest = {
  table: string;
  select: string;
  filterColumn: string;
  userId: string;
  orderColumn: string;
  /** Absent on a section's first page. */
  afterKey?: unknown;
  limit: number;
};

export type PageResult = { data: ExportRow[] | null; error: unknown };

export type ReadPage = (request: PageRequest) => Promise<PageResult>;

export type AccountExportResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 500; body: { error: string }; failedSections: string[] };

const EXPORT_FAILED_MESSAGE = "Failed to export some of your data. Please retry.";

function columnList(columns: string): string[] {
  return columns.split(",").map((c) => c.trim());
}

/**
 * The select a section's pages use. The keyset needs each page's last key, so
 * when the output columns do not include the order column it is selected as
 * well and removed from every row before the row is exported.
 */
export function selectForSection(section: ExportSection): {
  select: string;
  keyAdded: boolean;
} {
  if (
    section.columns === "*" ||
    columnList(section.columns).indexOf(section.orderColumn) !== -1
  ) {
    return { select: section.columns, keyAdded: false };
  }
  return { select: `${section.columns}, ${section.orderColumn}`, keyAdded: true };
}

async function readSection(
  section: ExportSection,
  userId: string,
  readPage: ReadPage,
  pageSize: number
): Promise<ExportRow[] | null> {
  const { select, keyAdded } = selectForSection(section);
  const rows: ExportRow[] = [];
  let afterKey: unknown = undefined;

  for (;;) {
    const request: PageRequest = {
      table: section.table,
      select,
      filterColumn: section.filterColumn,
      userId,
      orderColumn: section.orderColumn,
      limit: pageSize,
    };
    if (afterKey !== undefined) request.afterKey = afterKey;

    const result = await readPage(request);
    if (result.error) return null;
    const page = result.data ?? [];

    for (const row of page) {
      if (keyAdded) {
        const copy: ExportRow = { ...row };
        delete copy[section.orderColumn];
        rows.push(copy);
      } else {
        rows.push(row);
      }
    }

    if (page.length < pageSize) return rows;

    const lastKey = page[page.length - 1][section.orderColumn];
    // A full page without its key cannot be continued: asking again without a
    // key would restart the section and never end. Fail the export instead.
    if (lastKey === undefined || lastKey === null) return null;
    afterKey = lastKey;
  }
}

/**
 * @param userId The authenticated user id, from the verified Bearer token only.
 */
export async function buildAccountExport(
  userId: string,
  readPage: ReadPage,
  options: {
    sections?: readonly ExportSection[];
    pageSize?: number;
    now?: () => Date;
  } = {}
): Promise<AccountExportResult> {
  const sections = options.sections ?? EXPORT_SECTIONS;
  const pageSize = options.pageSize ?? EXPORT_PAGE_SIZE;
  const now = options.now ?? (() => new Date());

  const results = await Promise.all(
    sections.map((section) => readSection(section, userId, readPage, pageSize))
  );

  const failedSections = sections
    .filter((_, i) => results[i] === null)
    .map((section) => section.key);
  if (failedSections.length > 0) {
    return { status: 500, body: { error: EXPORT_FAILED_MESSAGE }, failedSections };
  }

  const body: Record<string, unknown> = {
    exported_at: now().toISOString(),
    user_id: userId,
  };
  sections.forEach((section, i) => {
    body[section.key] = results[i];
  });
  return { status: 200, body };
}

/** The production reader: one PostgREST request per page. */
export function makeSupabasePageReader(
  client: Pick<SupabaseClient, "from">
): ReadPage {
  return async (request) => {
    let query = client
      .from(request.table)
      .select(request.select)
      .eq(request.filterColumn, request.userId);
    if (request.afterKey !== undefined) {
      query = query.gt(request.orderColumn, request.afterKey);
    }
    const { data, error } = await query
      .order(request.orderColumn, { ascending: true })
      .limit(request.limit);
    return { data: (data as ExportRow[] | null) ?? null, error };
  };
}
