import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInviteEmail } from "./householdInvite";

/**
 * The decision half of GET /api/account/export — which tables are read, how
 * each is paged, and how the file is assembled. The route verifies the token,
 * builds the page reader, calls buildAccountExport and serializes the result,
 * so everything that decides anything here is reached by
 * accountExport.test.ts with an injected reader and no vi.mock.
 *
 * FILTERS
 * Every section is read by one column compared with a value taken from the
 * verified token only: the caller's id, or, for a section marked
 * filterBy "confirmed_email", the caller's address trimmed and lowercased the
 * way an invite's address is stored and accepted (normalizeInviteEmail). An
 * address that is not confirmed, or not an address, is not used: that
 * section is not read and comes out empty. Nothing from the request is used.
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
  /**
   * Compared with the verified caller's id, or with their confirmed address
   * when filterBy is "confirmed_email".
   */
  filterColumn: string;
  filterBy?: "confirmed_email";
  /** One more fixed equality every page of the section asks for. */
  extraEq?: { column: string; value: string };
  /** A unique key of the table; the keyset pages on it. */
  orderColumn: string;
  orderKeyType: ExportKeyType;
};

/**
 * Sections whose column list is explicit leave a filter column holding the
 * caller's id out (user_id, owner_user_id, invited_by, created_by): it always
 * equals the file's top-level user_id, and a column added to the table later
 * is not exported until someone decides it should be. The users table has no
 * user_id; its id is the user's own id, and its list carries it. A section
 * read by the caller's address keeps that column: it is the address the
 * invite was made for. A column that names another person by id is left out
 * as well (grantee_user_id on the share sections), and so is a stored hash
 * (code_hash on account_reauth_codes).
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
      "id, title, started_at, ended_at, last_message_at, message_count, summarized, facts_extracted, summary_failures, summary_next_attempt_at, summary_outcome, summary_given_up_reason, summary_given_up_at, facts_failures, facts_next_attempt_at, facts_outcome, facts_given_up_reason, facts_given_up_at, created_at, updated_at",
    filterColumn: "user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  { key: "chat_messages", table: "chat_messages", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  { key: "chat_summaries", table: "chat_summaries", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  { key: "user_facts", table: "user_facts", columns: "*", filterColumn: "user_id", orderColumn: "id", orderKeyType: "uuid" },
  // The stored bank credential is never selected; only these four columns.
  // id is the connection's own row id, the value the share sections'
  // resource_id names, so the file can tell which bank a share row is about.
  { key: "plaid_connections", table: "plaid_connections", columns: "institution_name, status, item_id, id", filterColumn: "user_id", orderColumn: "id", orderKeyType: "int8" },
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
  // One row per user, keyed by user_id, which the output leaves out.
  {
    key: "plaid_link_token_issues",
    table: "plaid_link_token_issues",
    columns: "window_start, window_count",
    filterColumn: "user_id",
    orderColumn: "user_id",
    orderKeyType: "uuid",
  },
  // The user's memberships, read by user_id. households itself is not
  // exported: it holds no user data, only its id (household_id here) and a
  // creation time.
  {
    key: "household_members",
    table: "household_members",
    columns: "id, household_id, role, status, joined_at, left_at",
    filterColumn: "user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // Grants the user made, read by owner_user_id. grantee_user_id, the
  // person the connection is shared with, is not exported: the other
  // member's identifier is their personal data.
  {
    key: "share_grants",
    table: "share_grants",
    columns: "id, household_id, resource_type, resource_id, scope, granted_at, revoked_at",
    filterColumn: "owner_user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // The record that the user was asked whether to share a connection, read
  // by owner_user_id. grantee_user_id is not exported, for the same reason.
  {
    key: "share_prompt_answers",
    table: "share_prompt_answers",
    columns: "id, household_id, resource_id, answered_at",
    filterColumn: "owner_user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // Personal goals only, read by owner_user_id. A joint goal belongs to a
  // household and has no owner_user_id, so it is not read here; the joint
  // goals the user created are read by joint_goals_created below.
  {
    key: "goals",
    table: "goals",
    columns:
      "id, kind, household_id, created_by, target_amount_cents, target_date, monthly_amount_cents, status, created_at, updated_at",
    filterColumn: "owner_user_id",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // Invites the user created, read by invited_by: the address they entered,
  // the household and the two times. token_hash is not exported; it names the
  // invite to the database and is nothing the user entered. Invites made to
  // the user by someone else are read by household_invites_received below.
  {
    key: "household_invites",
    table: "household_invites",
    columns: "id, household_id, invitee_email, created_at, expires_at",
    filterColumn: "invited_by",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // One row per user, keyed by user_id, which the output leaves out.
  // code_hash is not exported: it is the keyed hash of a one-time code,
  // nothing the user entered or can use.
  {
    key: "account_reauth_codes",
    table: "account_reauth_codes",
    columns: "purpose, expires_at, attempts, verified_at, window_start, window_count",
    filterColumn: "user_id",
    orderColumn: "user_id",
    orderKeyType: "uuid",
  },
  // One row per user, keyed by user_id, which the output leaves out.
  {
    key: "household_invite_issues",
    table: "household_invite_issues",
    columns: "window_start, window_count",
    filterColumn: "user_id",
    orderColumn: "user_id",
    orderKeyType: "uuid",
  },
  // Joint goals the user created, read by created_by and kind 'joint'.
  // created_by is the filter; owner_user_id is always null on a joint goal.
  {
    key: "joint_goals_created",
    table: "goals",
    columns:
      "id, kind, household_id, target_amount_cents, target_date, monthly_amount_cents, status, created_at, updated_at",
    filterColumn: "created_by",
    extraEq: { column: "kind", value: "joint" },
    orderColumn: "id",
    orderKeyType: "uuid",
  },
  // Invites made for the user's confirmed address, by anyone. Neither
  // token_hash nor who sent it (invited_by) nor their household
  // (household_id) is exported: none of them is the user's.
  {
    key: "household_invites_received",
    table: "household_invites",
    columns: "id, invitee_email, created_at, expires_at",
    filterColumn: "invitee_email",
    filterBy: "confirmed_email",
    orderColumn: "id",
    orderKeyType: "uuid",
  },
];

/** The verified caller, from the token only. */
export type ExportIdentity = {
  id: string;
  /** The address as the auth server returned it. */
  email: string | null;
  emailConfirmed: boolean;
};

/**
 * The address a "confirmed_email" section is read by: the confirmed address
 * trimmed and lowercased, or null when it is not confirmed or not an address.
 */
export function exportConfirmedEmail(identity: ExportIdentity): string | null {
  return identity.emailConfirmed ? normalizeInviteEmail(identity.email) : null;
}

export type ExportRow = Record<string, unknown>;

export type PageRequest = {
  table: string;
  select: string;
  filterColumn: string;
  /** The caller the export is for, from the verified token. */
  userId: string;
  /** The value filterColumn must equal: the caller's id or confirmed address. */
  filterValue: string;
  /** Present when the section asks for one more fixed equality. */
  extraEq?: { column: string; value: string };
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
  identity: ExportIdentity,
  readPage: ReadPage,
  pageSize: number
): Promise<ExportRow[] | null> {
  const filterValue =
    section.filterBy === "confirmed_email" ? exportConfirmedEmail(identity) : identity.id;
  // No confirmed address: nothing can be read by it, and nothing is.
  if (filterValue === null) return [];

  const { select, keyAdded } = selectForSection(section);
  const rows: ExportRow[] = [];
  let afterKey: unknown = undefined;

  for (;;) {
    const request: PageRequest = {
      table: section.table,
      select,
      filterColumn: section.filterColumn,
      userId: identity.id,
      filterValue,
      orderColumn: section.orderColumn,
      limit: pageSize,
    };
    if (section.extraEq) request.extraEq = { ...section.extraEq };
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
 * @param identity The authenticated user's id, address and whether the address
 *                 is confirmed, from the verified Bearer token only.
 */
export async function buildAccountExport(
  identity: ExportIdentity,
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
    sections.map((section) => readSection(section, identity, readPage, pageSize))
  );

  const failedSections = sections
    .filter((_, i) => results[i] === null)
    .map((section) => section.key);
  if (failedSections.length > 0) {
    return { status: 500, body: { error: EXPORT_FAILED_MESSAGE }, failedSections };
  }

  const body: Record<string, unknown> = {
    exported_at: now().toISOString(),
    user_id: identity.id,
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
      .eq(request.filterColumn, request.filterValue);
    if (request.extraEq !== undefined) {
      query = query.eq(request.extraEq.column, request.extraEq.value);
    }
    if (request.afterKey !== undefined) {
      query = query.gt(request.orderColumn, request.afterKey);
    }
    const { data, error } = await query
      .order(request.orderColumn, { ascending: true })
      .limit(request.limit);
    return { data: (data as ExportRow[] | null) ?? null, error };
  };
}
