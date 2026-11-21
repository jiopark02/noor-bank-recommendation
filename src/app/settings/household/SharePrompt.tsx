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
  shareNoticeFor,
  sharePromptLines,
  sharingSettingsLines,
  type ShareNotice,
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
 * and when there is nothing to ask, it renders nothing but a notice. A refusal
 * to reload on (the bank or the other member is gone, the household changed)
 * reads the view again and keeps that answer's sentence as a notice about the
 * bank it was about; any other failure keeps the question and says "Try
 * again" (afterShareAnswer). sharePromptLines decides where the notice goes:
 * under the question while it is about that bank, otherwise on a line of its
 * own naming the bank. A refreshKey change clears the notice; the read after
 * an answer does not. Only the latest load is applied (createLatestOnly), so a
 * load started before refreshKey changed cannot overwrite the newer one. It
 * shows no amounts, writes nothing to browser storage and never signs anyone
 * out.
 */
export default function SharePrompt({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SharingData | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ShareNotice | null>(null);
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
    setNotice(null);
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load, refreshKey]);

  const lines = sharePromptLines(data, notice);
  const view = lines.view;
  if (view.kind === "none" && lines.alone === null) return null;

  const answer = async (itemId: string, institutionName: string, shared: boolean) => {
    setSaving(true);
    setNotice(null);
    const outcome = await answerShare(
      () => readSession(undefined, "household-mount"),
      browserHouseholdHttp,
      itemId,
      shared
    );
    if (!mountedRef.current) return;
    setSaving(false);
    const step = afterShareAnswer(outcome);
    setNotice(shareNoticeFor(step, itemId, institutionName));
    if (step.reload) await load();
  };

  return (
    <div className="noor-card p-5 w-full mb-4">
      {lines.alone && (
        <p className={`text-[13px] ${view.kind === "ask" ? "mb-3" : ""}`} style={{ color: "#B91C1C" }}>
          {lines.alone}
        </p>
      )}
      {view.kind === "ask" && (
        <>
          <p className="text-[15px] font-semibold text-black">
            {HOUSEHOLD_UI.shareQuestion(view.institutionName, view.partnerFirstName)}
          </p>
          <p className="text-[13px] mt-2" style={{ color: "rgba(0,0,0,0.55)" }}>
            {HOUSEHOLD_UI.shareExplainer(view.partnerFirstName)}
          </p>
          {lines.underQuestion && (
            <p className="text-[13px] mt-2" style={{ color: "#B91C1C" }}>
              {lines.underQuestion}
            </p>
          )}
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => answer(view.itemId, view.institutionName, false)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[14px] font-medium disabled:opacity-40"
              style={{ background: "rgba(0,0,0,0.06)", color: "#000" }}
            >
              {HOUSEHOLD_UI.notNow}
            </button>
            <button
              type="button"
              onClick={() => answer(view.itemId, view.institutionName, true)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white bg-black disabled:opacity-40"
            >
              {saving ? HOUSEHOLD_UI.shareSaving : HOUSEHOLD_UI.shareButton}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The household screen's list of the caller's banks, each with whether it is
 * shared with the other member and a button to change it. Same reads and
 * writes as SharePrompt; takes only refreshKey. It renders nothing while
 * loading and when there is no other member, and one line when the load
 * failed. A notice from an answer names its bank and is drawn in every one of
 * those cases (sharingSettingsLines); a refreshKey change clears it.
 */
export function SharingSettings({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SharingData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [notice, setNotice] = useState<ShareNotice | null>(null);
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
    setNotice(null);
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load, refreshKey]);

  const lines = sharingSettingsLines(loaded, data, notice);
  if (lines.body === "nothing" && lines.notice === null) return null;

  const noticeLine = lines.notice && (
    <p className="text-[13px] mt-3" style={{ color: "#B91C1C" }}>
      {lines.notice}
    </p>
  );

  if (lines.body !== "list" || data === null) {
    return (
      <div className="mx-5 mt-4">
        {lines.body === "unavailable" && (
          <p className="text-[13px]" style={{ color: "rgba(0,0,0,0.45)" }}>
            {HOUSEHOLD_UI.sharingUnavailable}
          </p>
        )}
        {noticeLine}
      </div>
    );
  }

  const toggle = async (itemId: string, institutionName: string, shared: boolean) => {
    setSavingItem(itemId);
    setNotice(null);
    const outcome = await answerShare(
      () => readSession(undefined, "household-mount"),
      browserHouseholdHttp,
      itemId,
      shared
    );
    if (!mountedRef.current) return;
    setSavingItem(null);
    const step = afterShareAnswer(outcome);
    setNotice(shareNoticeFor(step, itemId, institutionName));
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
            onClick={() => toggle(connection.itemId, connection.institutionName, !connection.shared)}
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
      {noticeLine}
    </div>
  );
}
