"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SharePrompt from "@/app/settings/household/SharePrompt";
import SharedAccounts from "./SharedAccounts";
import { readSession } from "@/lib/supabase-browser";
import { HOUSEHOLD_UI } from "@/lib/householdCopy";
import {
  browserHouseholdHttp,
  loadHouseholdCard,
  memberKey,
  memberLineText,
  type HouseholdCardView,
} from "@/lib/householdClient";

/**
 * The dashboard's household card: who is in the caller's household, the
 * Manager's open invite, and a way to the household screen when the caller
 * is on their own. It reads GET /api/household through loadHouseholdCard
 * (src/lib/householdClient.ts) and nothing else, holds its own state, and
 * takes no props, so its load, failure or delay reaches no other card. This
 * file shows no amounts itself, never signs anyone out, and writes nothing
 * to browser storage: a session that has ended shows the card as
 * unavailable, and the page decides about the session. Inside it, when the
 * household has two people, SharePrompt makes its own request to GET
 * /api/household/sharing and asks whether to share a bank with the other
 * member; it renders nothing until there is a question. SharedAccounts makes
 * its own request to GET /api/household/shared-accounts and lists the
 * accounts and balances the other member shares with the caller; it renders
 * nothing when nothing is shared.
 */
export default function HouseholdCard() {
  const [view, setView] = useState<HouseholdCardView>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadHouseholdCard(
      () => readSession(undefined, "dashboard-mount"),
      browserHouseholdHttp
    ).then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="noor-card p-6 w-full">
      <h2 className="text-2xl font-semibold text-black">{HOUSEHOLD_UI.title}</h2>

      {view.kind === "loading" && (
        <p role="status" className="mt-3 text-sm text-gray-500">
          {HOUSEHOLD_UI.loading}
        </p>
      )}

      {view.kind === "unavailable" && (
        <p className="mt-3 text-sm text-gray-500">{HOUSEHOLD_UI.cardUnavailable}</p>
      )}

      {view.kind === "ready" && (
        <div className="mt-3">
          {view.members.map((member, i) => (
            <p key={memberKey(view.members, i)} className="text-sm text-black py-0.5">
              {memberLineText(member)}
            </p>
          ))}

          {view.invite && (
            <div className="mt-3">
              <p className="text-sm text-black">
                {HOUSEHOLD_UI.pendingPrefix} {view.invite.email}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {HOUSEHOLD_UI.expiresPrefix}{" "}
                {new Date(view.invite.expiresAt).toLocaleString()}
              </p>
            </div>
          )}

          {view.showInviteLink && (
            <Link
              href="/settings/household"
              className="mt-4 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-medium border-[1.5px] border-black text-black bg-white hover:bg-black hover:text-white transition-colors"
            >
              {HOUSEHOLD_UI.cardInvite}
            </Link>
          )}

          {!view.showInviteLink && (
            <div className="mt-4">
              <SharePrompt refreshKey={0} />
            </div>
          )}

          {!view.showInviteLink && (
            <div className="mt-4">
              <SharedAccounts />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
