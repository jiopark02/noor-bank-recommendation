import { describe, it } from "vitest";
import { codeBySourceFile, expectAllowlistHolds, word, type ProbeTarget } from "./sourceProbe";

/**
 * Which application files name the household sharing tables, and the function
 * that creates grants, in code.
 *
 * These names reach another person's data: a grant, the record that the owner
 * was asked, the mark that shared bank data entered a chat session,
 * household_share_set, the only function that inserts grants, and
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
      "lib/aiMemory.ts": "the earliest shared moment, read by the memory crons and by the chat route to see whether the session is marked",
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
