"use client";

import { useEffect, useState } from "react";
import { readSession } from "@/lib/supabase-browser";
import { browserHouseholdHttp } from "@/lib/householdClient";
import {
  loadSharedAccounts,
  sharedAccountsView,
  type SharedAccountsView,
} from "@/lib/sharedAccountsClient";

/**
 * The accounts and balances other household members share with the caller,
 * inside the dashboard's household card. It makes its own request to GET
 * /api/household/shared-accounts, holds its own state and takes no props, so
 * its load or failure reaches nothing else on the card. What it shows is
 * decided in src/lib/sharedAccountsClient.ts.
 *
 * While loading, and when nothing is shared with the caller, it renders
 * nothing. A failed load shows one sentence. A bank that could not be read,
 * or that was read and has no account, shows a sentence under its name. It
 * shows no total, writes nothing to browser storage and never signs anyone
 * out.
 */
export default function SharedAccounts() {
  const [view, setView] = useState<SharedAccountsView>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadSharedAccounts(
      () => readSession(undefined, "dashboard-mount"),
      browserHouseholdHttp
    ).then((owners) => {
      if (!cancelled) setView(sharedAccountsView(owners));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.kind === "loading" || view.kind === "nothing") return null;

  if (view.kind === "unavailable") {
    return <p className="text-sm text-gray-500">{view.text}</p>;
  }

  return (
    <section aria-label={view.title}>
      <h3 className="text-base font-semibold text-black">{view.title}</h3>
      {view.owners.map((owner) => (
        <div key={owner.key} className="mt-2">
          <p className="text-sm text-gray-500">{owner.owner}</p>
          {owner.banks.map((bank) => (
            <div key={bank.key} className="mt-2">
              <p className="text-sm font-medium text-black">{bank.bank}</p>
              {bank.unreadable !== null && (
                <p className="text-sm text-gray-500">{bank.unreadable}</p>
              )}
              {bank.empty !== null && (
                <p className="text-sm text-gray-500">{bank.empty}</p>
              )}
              {bank.accounts.map((account) => (
                <div key={account.key} className="flex items-start justify-between py-1">
                  <div className="min-w-0">
                    <p className="text-sm text-black truncate">{account.name}</p>
                    <p className="text-xs text-gray-500">{account.detail}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-medium text-black">{account.current}</p>
                    <p className="text-xs text-gray-500">{account.available}</p>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
