/**
 * crisisNoticeTally — adds one to the daily count of crisis notices the chat
 * route showed, through chat_crisis_notice_record and the service-role
 * client. The count carries a category and a variant only; the database picks
 * the UTC day.
 *
 * recordCrisisNotice NEVER REJECTS, NEVER WAITS LONGER THAN
 * CRISIS_NOTICE_RECORD_TIMEOUT_MS AND NEVER LOGS. It runs on the way out of a
 * chat request, alongside the usage settle, so a rejection would replace the
 * route's response and a hang would hold it. A failed count is dropped
 * without a log line: a line about a crisis notice in the same request's logs
 * could be tied to the user through the usage reservation logged beside it.
 */

import { createAdminClient } from "@/lib/supabase";
import type { CrisisCategory } from "@/lib/crisisSignals";
import type { CrisisVariant } from "@/lib/crisisNotice";

/**
 * At most the usage settle's own timeout, so recording the count beside the
 * settle does not lengthen the request's exit.
 */
export const CRISIS_NOTICE_RECORD_TIMEOUT_MS = 500;

export interface CrisisNoticeTallyDeps {
  rpc: (
    fn: "chat_crisis_notice_record",
    args: { p_category: CrisisCategory; p_variant: CrisisVariant },
    signal: AbortSignal
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
}

const defaultDeps: CrisisNoticeTallyDeps = {
  rpc: (fn, args, signal) =>
    createAdminClient().rpc(fn, args).abortSignal(signal),
};

export interface CrisisNoticeRecordInput {
  category: CrisisCategory;
  variant: CrisisVariant;
}

export async function recordCrisisNotice(
  input: CrisisNoticeRecordInput,
  deps: CrisisNoticeTallyDeps = defaultDeps
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Promise.resolve().then turns a synchronous throw into a rejection.
    const attempt = Promise.resolve().then(() =>
      deps.rpc(
        "chat_crisis_notice_record",
        { p_category: input.category, p_variant: input.variant },
        controller.signal
      )
    );
    attempt.then(undefined, () => undefined);

    const timeout = new Promise<"timed_out">((resolve) => {
      timer = setTimeout(
        () => resolve("timed_out"),
        deps.timeoutMs ?? CRISIS_NOTICE_RECORD_TIMEOUT_MS
      );
    });

    const outcome = await Promise.race([attempt, timeout]);
    if (outcome === "timed_out") controller.abort();
  } catch {
    // Dropped: see the header.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
