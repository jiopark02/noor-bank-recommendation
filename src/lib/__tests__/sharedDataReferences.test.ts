import { describe, it } from "vitest";
import { codeBySourceFile, expectAllowlistHolds, word, type ProbeTarget } from "./sourceProbe";

/**
 * Which application files name the household sharing tables, and the function
 * that creates grants, in code.
 *
 * These names reach another person's data: a grant, the record that the owner
 * was asked, the mark that shared bank data entered a chat session, the
 * summaries kept of that part of a session with the function that stores
 * them, household_share_set, the only function that inserts grants, and
 * household_shared_connections, the function that returns the connections
 * another member shares with a person, stored tokens included. household_leave
 * also deletes grants but is not listed: this probe guards the names that can
 * widen exposure, and deleting a grant narrows it. Each name has its own
 * allowlist of files, so a new file naming one of them fails here and has to
 * be added with a reason, which makes the addition visible in review. An
 * allowlisted file that stops naming its target fails too, so the list cannot
 * go stale.
 *
 * shareGrantReferences.test.ts keeps its own narrower guarantee (the grantee
 * column, and the bank-reading modules with their comments); this file does
 * not replace it.
 *
 * Code is read with comments removed and matched as whole words. It executes
 * nothing. Limit: a name passed through a variable (client.rpc(fn, args),
 * .from(table)) is not seen.
 */

const TARGETS: ProbeTarget[] = [
  {
    name: "share_grants",
    pattern: word("share_grants"),
    allowed: {
      // Exports the grants the user made, read by owner_user_id.
      "lib/accountExport.ts": "export section of the user's own grants",
      // readGrants lists the caller's grants for the sharing route.
      "lib/householdShareStore.ts": "the sharing route's read of the caller's grants",
    },
  },
  {
    name: "share_prompt_answers",
    pattern: word("share_prompt_answers"),
    allowed: {
      // Exports the records that the user was asked, read by owner_user_id.
      "lib/accountExport.ts": "export section of the user's own prompt records",
      // readAnswers lists which connections the caller was already asked about.
      "lib/householdShareStore.ts": "the sharing route's read of the caller's prompt records",
    },
  },
  {
    name: "chat_shared_sources",
    pattern: word("chat_shared_sources"),
    allowed: {
      // Exports the session and moment shared data entered the user's chats.
      "lib/accountExport.ts": "export section of the user's own shared-source marks",
      // getEarliestSharedSourceTime: the memory crons read only before this moment.
      // getSessionSharedSources: the chat route saves a marked session's turns
      // through chat_shared_turn_save.
      "lib/aiMemory.ts": "the earliest shared moment, read by the memory crons, and the session's marked sources, read by the chat route before a turn's history and again after it",
    },
  },
  {
    name: "household_share_set",
    pattern: word("household_share_set"),
    allowed: {
      // setShare calls the function that inserts or deletes a grant.
      "lib/householdShareStore.ts": "the sharing route's only write of a grant",
    },
  },
  {
    name: "chat_shared_turn_save",
    pattern: word("chat_shared_turn_save"),
    allowed: {
      // saveSharedTurn: the only save of a turn whose prompt carried another member's bank data.
      "lib/aiMemory.ts": "the only call of the function that records the shared sources and stores the turn together",
    },
  },
  {
    name: "chat_shared_summaries",
    pattern: word("chat_shared_summaries"),
    allowed: {
      // Exports the summaries kept of the shared-data part of the user's chats.
      "lib/accountExport.ts": "export section of the user's own shared summaries",
      // hasSharedSummary and getSharedSummariesForSources: the caller's own rows.
      "lib/aiMemory.ts": "whether a session already has one, read by the summarize cron, and the user's own summaries a turn may carry, read for the chat prompt",
    },
  },
  {
    name: "chat_shared_summary_sources",
    pattern: word("chat_shared_summary_sources"),
    allowed: {
      // Exports which summary was made from a shared connection, without naming it.
      "lib/accountExport.ts": "export section of the user's own summary-source rows",
      // getSharedSummariesForSources: a summary is kept only when every link is in the turn.
      "lib/aiMemory.ts": "the connections each of the user's shared summaries was made from, read to decide which a turn may carry",
    },
  },
  {
    name: "chat_shared_summary_save",
    pattern: word("chat_shared_summary_save"),
    allowed: {
      // saveSharedSummary: the only write of a shared summary and its links.
      "lib/aiMemory.ts": "the only call of the function that stores a shared summary with the connections it was made from",
    },
  },
  {
    name: "household_shared_connections",
    pattern: word("household_shared_connections"),
    allowed: {
      // readSharedConnections: the rows another member shares with the caller,
      // called with the verified caller's id only.
      "lib/householdSharedAccountsStore.ts":
        "the only read of connections another member shares with the caller",
    },
  },
];

describe("household sharing names in application code", () => {
  for (const target of TARGETS) {
    it(`only allowlisted files name ${target.name}`, () => {
      expectAllowlistHolds(codeBySourceFile(), target);
    });
  }
});
