"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readSession } from "@/lib/supabase-browser";
import { HOUSEHOLD_UI } from "@/lib/householdCopy";
import {
  afterShareAnswer,
  answerShare,
  browserHouseholdHttp,
  createLatestOnly,
  loadSharing,
  sharePromptView,
  type SharingData,
} from "@/lib/householdClient";

/**
 * Asks once per bank connection and person whether to share that bank with
 * the other member of the household. It reads GET /api/household/sharing and
 * answers through PUT on the same path (src/lib/householdClient.ts), holds its
 * own state, and takes only refreshKey, which a screen changes to make it read
 * again (after a new bank is connected, say).
 *
 * It never holds up the screen it is on: while loading, when the load fails,
 * and when there is nothing to ask, it renders nothing. An answer another
 * press cannot change (the bank or the other member is gone, the household
 * changed) reads the view again and shows that answer's sentence; any other
 * failure shows "Try again" and keeps the question (afterShareAnswer).
 * Only the latest load is applied (createLatestOnly), so a load started
 * before refreshKey changed cannot overwrite the newer one. It shows no
 * amounts, writes nothing to browser storage and never signs anyone out.
 */
export default function SharePrompt({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SharingData | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef(createLatestOnly());

  const load = useCallback(async () => {
    const isLatest = latestRef.current.begin();
    const next = await loadSharing(
      () => readSession(undefined, "household-mount"),
      browserHouseholdHttp
    );
    if (!mountedRef.current || !isLatest()) return;
    setData(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load, refreshKey]);

  const view = sharePromptView(data);
  if (view.kind === "none") return null;

  const answer = async (shared: boolean) => {
    setSaving(true);
    setMessage(null);
    const outcome = await answerShare(
      () => readSession(undefined, "household-mount"),
      browserHouseholdHttp,
      view.itemId,
      shared
    );
    if (!mountedRef.current) return;
    setSaving(false);
    const step = afterShareAnswer(outcome);
    setMessage(step.message);
    if (step.reload) await load();
  };

  return (
    <div className="noor-card p-5 w-full mb-4">
      <p className="text-[15px] font-semibold text-black">
        {HOUSEHOLD_UI.shareQuestion(view.institutionName, view.partnerFirstName)}
      </p>
      <p className="text-[13px] mt-2" style={{ color: "rgba(0,0,0,0.55)" }}>
        {HOUSEHOLD_UI.shareExplainer(view.partnerFirstName)}
      </p>
      {message && (
        <p className="text-[13px] mt-2" style={{ color: "#B91C1C" }}>
          {message}
        </p>
      )}
      <div className="flex gap-3 mt-4">
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-[14px] font-medium disabled:opacity-40"
          style={{ background: "rgba(0,0,0,0.06)", color: "#000" }}
        >
          {HOUSEHOLD_UI.notNow}
        </button>
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white bg-black disabled:opacity-40"
        >
          {saving ? HOUSEHOLD_UI.shareSaving : HOUSEHOLD_UI.shareButton}
        </button>
      </div>
    </div>
  );
}

/**
 * The household screen's list of the caller's banks, each with whether it is
 * shared with the other member and a button to change it. Same reads and
 * writes as SharePrompt; takes only refreshKey. It renders nothing while
 * loading and when there is no other member, and one line when the load
 * failed.
 */
export function SharingSettings({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SharingData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef(createLatestOnly());

  const load = useCallback(async () => {
    const isLatest = latestRef.current.begin();
    const next = await loadSharing(
      () => readSession(undefined, "household-mount"),
      browserHouseholdHttp
    );
    if (!mountedRef.current || !isLatest()) return;
    setData(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load, refreshKey]);

  if (!loaded) return null;
  if (data === null) {
    return (
      <p className="mx-5 mt-4 text-[13px]" style={{ color: "rgba(0,0,0,0.45)" }}>
        {HOUSEHOLD_UI.sharingUnavailable}
      </p>
    );
  }
  if (!data.eligible) return null;

  const toggle = async (itemId: string, shared: boolean) => {
    setSavingItem(itemId);
    setMessage(null);
    const outcome = await answerShare(
      () => readSession(undefined, "household-mount"),
      browserHouseholdHttp,
      itemId,
      shared
    );
    if (!mountedRef.current) return;
    setSavingItem(null);
    const step = afterShareAnswer(outcome);
    setMessage(step.message);
    if (step.reload) await load();
  };

  return (
    <div className="mx-4 mt-4 rounded-2xl p-5 bg-white" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
      <p className="text-[15px] font-semibold text-black">{HOUSEHOLD_UI.sharingSection}</p>
      <p className="text-[13px] mt-1" style={{ color: "rgba(0,0,0,0.55)" }}>
        {HOUSEHOLD_UI.sharingNote(data.partnerFirstName)}
      </p>
      {data.connections.length === 0 && (
        <p className="text-[13px] mt-3" style={{ color: "rgba(0,0,0,0.45)" }}>
          {HOUSEHOLD_UI.sharingNoBanks}
        </p>
      )}
      {data.connections.map((connection) => (
        <div key={connection.itemId} className="flex items-center justify-between gap-3 mt-3">
          <div>
            <p className="text-[14px] text-black">{connection.institutionName || "—"}</p>
            <p className="text-[12px]" style={{ color: "rgba(0,0,0,0.45)" }}>
              {connection.shared ? HOUSEHOLD_UI.sharedLabel : HOUSEHOLD_UI.notSharedLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggle(connection.itemId, !connection.shared)}
            disabled={savingItem !== null}
            className="px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-40"
            style={{ background: "rgba(0,0,0,0.06)", color: "#000" }}
          >
            {savingItem === connection.itemId
              ? HOUSEHOLD_UI.shareSaving
              : connection.shared
                ? HOUSEHOLD_UI.stopSharing
                : HOUSEHOLD_UI.shareButton}
          </button>
        </div>
      ))}
      {message && (
        <p className="text-[13px] mt-3" style={{ color: "#B91C1C" }}>
          {message}
        </p>
      )}
    </div>
  );
}
