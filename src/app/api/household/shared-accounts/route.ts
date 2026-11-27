import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { householdGate, householdResponse } from "@/lib/householdRoute";
import { isPlaidConfigured } from "@/lib/plaid";
import { isPlaidTokenCryptoConfigured } from "@/lib/plaidTokenCrypto";
import { bankWindow, liveAdapterDeps, readBankData } from "@/lib/plaidEngineAdapter";
import { makeSharedAccountsStore } from "@/lib/householdSharedAccountsStore";
import {
  resolveSharedAccountsMode,
  viewSharedAccounts,
  type OwnerRead,
} from "@/lib/householdSharedAccounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACCOUNTS_ONLY = { accounts: true, transactions: false, recurring: false };

/**
 * One owner's connections, read with that owner's id: the id the stored
 * token is bound to. Accounts only, with no Item read, as the chat's bank
 * state reads them.
 */
const readOwner: OwnerRead = (ownerUserId, rows, signal) => {
  const today = new Date().toISOString().slice(0, 10);
  return readBankData(ownerUserId, rows, ACCOUNTS_ONLY, bankWindow(today, 1), liveAdapterDeps(), {
    itemStatus: false,
    signal,
    logOrigin: "household-shared",
  });
};

export async function GET(request: NextRequest) {
  const gate = await householdGate(request);
  if (!gate.ok) return gate.response;
  const { identity, log } = gate.context;
  const mode = resolveSharedAccountsMode(process.env.HOUSEHOLD_SHARED_ACCOUNTS_MODE);
  return householdResponse(
    await viewSharedAccounts(identity.id, {
      mode,
      store: makeSharedAccountsStore(createAdminClient()),
      readOwner: isPlaidConfigured() && isPlaidTokenCryptoConfigured() ? readOwner : null,
      log,
      // A fully read answer is routine; a failure, or an answer with a
      // connection that could not be read, stays on the gate's warn line.
      info: (line) => console.info(line),
    })
  );
}
