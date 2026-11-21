'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomNav } from '@/components/layout';
import { readSession, type SessionReadResult } from '@/lib/supabase-browser';
import {
  PROTECTED_SESSION_RETRY,
  decideProtectedMount,
  retryUntilAnswered,
  shouldRetrySessionRead,
  waitMs,
} from '@/lib/sessionFlow';
import { clearLocalAuthState } from '@/lib/validation';
import { HOUSEHOLD_UI } from '@/lib/householdCopy';
import {
  browserHouseholdHttp,
  buildInviteLink,
  cancelButtonLabel,
  createButtonLabel,
  householdCall,
  householdLoadView,
  leaveConfirmLabel,
  householdMessage,
  isOk,
  memberKey,
  memberLineText,
  readHouseholdData,
  type HouseholdBusyAction,
  type HouseholdData,
} from '@/lib/householdClient';

const FONT = "'SF Pro Display', 'Helvetica Neue', -apple-system, Inter, sans-serif";
const ACCENT = '#5B4EE8';

/**
 * /settings/household — the caller's household: who is in it, the invite
 * link (created here, shown once, never stored), and leaving. Every request
 * goes out with the session's access token or not at all
 * (src/lib/householdClient.ts).
 */
export default function HouseholdPage() {
  const router = useRouter();
  const mountedRef = useRef(false);
  const [sessionDelayed, setSessionDelayed] = useState(false);
  const [data, setData] = useState<HouseholdData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The action in flight. Every button is disabled while one runs; only the
  // running action's button shows its progress label.
  const [busy, setBusy] = useState<HouseholdBusyAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (given?: SessionReadResult) => {
    const read = given ?? (await readSession(undefined, 'household-mount'));
    const outcome = await householdCall(read, browserHouseholdHttp, '/api/household', 'GET');
    if (!mountedRef.current) return;
    const parsed = isOk(outcome) ? readHouseholdData(outcome.body) : null;
    if (parsed) {
      setData(parsed);
      setLoadError(null);
    } else {
      setLoadError(householdMessage(outcome));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const read = await retryUntilAnswered(
        (timeoutMs, attempt) => readSession(timeoutMs, "household-mount", attempt),
        shouldRetrySessionRead,
        PROTECTED_SESSION_RETRY,
        { sleep: waitMs, isCancelled: () => cancelled }
      );
      if (cancelled) return;
      const action = decideProtectedMount(read);
      if (action === "sign-out") {
        clearLocalAuthState();
        router.replace("/login");
        return;
      }
      if (action === "show-delayed" || read.status !== "session") {
        setSessionDelayed(true);
        return;
      }
      await load(read);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, load]);

  const handleCreateInvite = async () => {
    setBusy('create');
    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      const read = await readSession(undefined, 'household-mount');
      const outcome = await householdCall(read, browserHouseholdHttp, '/api/household/invite', 'POST', {
        email,
      });
      if (!mountedRef.current) return;
      if (isOk(outcome) && typeof outcome.body.token === 'string') {
        setCreatedLink(buildInviteLink(window.location.origin, outcome.body.token));
        setEmail('');
        await load();
      } else {
        setError(householdMessage(outcome));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleCancelInvite = async () => {
    setBusy('cancel');
    setError(null);
    setNotice(null);
    try {
      const read = await readSession(undefined, 'household-mount');
      const outcome = await householdCall(read, browserHouseholdHttp, '/api/household/invite', 'DELETE');
      if (!mountedRef.current) return;
      if (isOk(outcome)) {
        setCreatedLink(null);
        setNotice(HOUSEHOLD_UI.cancelled);
        await load();
      } else {
        setError(householdMessage(outcome));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleLeave = async () => {
    setBusy('leave');
    setError(null);
    setNotice(null);
    try {
      const read = await readSession(undefined, 'household-mount');
      const outcome = await householdCall(read, browserHouseholdHttp, '/api/household/leave', 'POST');
      if (!mountedRef.current) return;
      setConfirmLeave(false);
      if (isOk(outcome)) {
        setCreatedLink(null);
        setNotice(HOUSEHOLD_UI.leftHousehold);
        await load();
      } else {
        setError(householdMessage(outcome));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      if (mountedRef.current) setCopied(true);
    } catch {
      // The link stays on screen to copy by hand.
    }
  };

  // Reloads rather than reading again: a client whose auth read has hung stays
  // hung until the page recreates it.
  if (sessionDelayed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-sm w-full text-center">
          <p className="text-gray-500 mb-6">{HOUSEHOLD_UI.sessionUnconfirmed}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
          >
            {HOUSEHOLD_UI.reload}
          </button>
        </div>
      </div>
    );
  }

  const others = data ? data.members.filter((m) => !m.self) : [];
  const isOwner = data?.role === 'owner';
  const full = data ? data.members.length >= data.maxMembers : false;

  return (
    <div className="min-h-screen pb-28" style={{ background: '#F5F5F5', fontFamily: FONT }}>
      <div
        className="sticky top-0 z-30"
        style={{
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={() => router.push('/settings')}
            className="w-8 h-8 flex items-center justify-center rounded-full"
            style={{ background: 'rgba(0,0,0,0.06)' }}
            aria-label="Back"
          >
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-[17px] font-semibold text-black tracking-tight">{HOUSEHOLD_UI.title}</h1>
        </div>
      </div>

      {notice && (
        <div className="mx-4 mt-4 px-4 py-3 rounded-2xl text-[13px] text-white" style={{ background: '#111' }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="mx-4 mt-4 px-4 py-3 rounded-2xl text-[13px] text-white" style={{ background: '#7F1D1D' }}>
          {error}
        </div>
      )}

      {householdLoadView(data, loadError) === 'loading' && (
        <p role="status" className="mx-5 mt-5 text-[14px]" style={{ color: 'rgba(0,0,0,0.45)' }}>
          {HOUSEHOLD_UI.loading}
        </p>
      )}

      {loadError && !data && (
        <div className="mx-4 mt-5 rounded-2xl p-5 bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
          <p className="text-[14px] text-black mb-4">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-black text-white rounded-xl text-[14px] font-medium"
          >
            {HOUSEHOLD_UI.reload}
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="mx-4 mt-5 rounded-2xl p-5 bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
            {data.members.map((member, i) => (
              <div key={memberKey(data.members, i)} className="text-[14px] text-black py-1">
                {memberLineText(member)}
              </div>
            ))}
            {others.length === 0 && (
              <p className="text-[13px] mt-2" style={{ color: 'rgba(0,0,0,0.45)' }}>
                {HOUSEHOLD_UI.alone}
              </p>
            )}
            <p className="text-[12px] mt-3" style={{ color: 'rgba(0,0,0,0.38)' }}>
              {HOUSEHOLD_UI.explainer}
            </p>
          </div>

          {!isOwner && (
            <p className="mx-5 mt-4 text-[13px]" style={{ color: 'rgba(0,0,0,0.45)' }}>
              {HOUSEHOLD_UI.memberCannotInvite}
            </p>
          )}

          {isOwner && full && (
            <p className="mx-5 mt-4 text-[13px]" style={{ color: 'rgba(0,0,0,0.45)' }}>
              {HOUSEHOLD_UI.full}
            </p>
          )}

          {isOwner && !full && (
            <div className="mx-4 mt-4 rounded-2xl p-5 bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
              {createdLink && (
                <div className="mb-5">
                  <p className="text-[14px] font-semibold text-black mb-2">{HOUSEHOLD_UI.linkCreated}</p>
                  <p
                    className="text-[12px] break-all px-3 py-2 rounded-xl mb-2"
                    style={{ background: 'rgba(0,0,0,0.04)', color: '#000' }}
                  >
                    {createdLink}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="w-full py-2.5 rounded-xl text-[14px] font-medium text-white"
                    style={{ background: ACCENT }}
                  >
                    {copied ? HOUSEHOLD_UI.copied : HOUSEHOLD_UI.copyLink}
                  </button>
                  <p className="text-[12px] mt-2" style={{ color: 'rgba(0,0,0,0.45)' }}>
                    {HOUSEHOLD_UI.linkNote}
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
                    {HOUSEHOLD_UI.linkSignInNote}
                  </p>
                </div>
              )}

              {data.invite && (
                <div className="mb-5">
                  <p className="text-[14px] text-black">
                    {HOUSEHOLD_UI.pendingPrefix} {data.invite.email}
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'rgba(0,0,0,0.45)' }}>
                    {HOUSEHOLD_UI.expiresPrefix} {new Date(data.invite.expiresAt).toLocaleString()}
                  </p>
                  <button
                    type="button"
                    onClick={handleCancelInvite}
                    disabled={busy !== null}
                    className="mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium disabled:opacity-40"
                    style={{ background: 'rgba(0,0,0,0.06)', color: '#000' }}
                  >
                    {cancelButtonLabel(busy)}
                  </button>
                </div>
              )}

              <label
                className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'rgba(0,0,0,0.35)', letterSpacing: '0.1em' }}
                htmlFor="household-invite-email"
              >
                {HOUSEHOLD_UI.emailLabel}
              </label>
              <input
                id="household-invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                className="w-full px-4 py-3 rounded-xl text-[14px] outline-none"
                style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', color: '#000' }}
              />
              <button
                type="button"
                onClick={handleCreateInvite}
                disabled={busy !== null || email.trim() === ''}
                className="mt-3 w-full py-3 rounded-xl text-[14px] font-medium text-white disabled:opacity-40"
                style={{ background: ACCENT }}
              >
                {createButtonLabel(busy, data.invite !== null)}
              </button>
              <p className="text-[12px] mt-2" style={{ color: 'rgba(0,0,0,0.45)' }}>
                {HOUSEHOLD_UI.formNote}
              </p>
              {data.invite && (
                <p className="text-[12px] mt-1" style={{ color: 'rgba(0,0,0,0.45)' }}>
                  {HOUSEHOLD_UI.newLinkNote}
                </p>
              )}
            </div>
          )}

          {others.length > 0 && (
            <div className="mx-4 mt-6">
              {!confirmLeave ? (
                <button
                  type="button"
                  onClick={() => setConfirmLeave(true)}
                  className="w-full py-3.5 rounded-2xl text-[14px] font-medium"
                  style={{ background: '#fff', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}
                >
                  {HOUSEHOLD_UI.leaveButton}
                </button>
              ) : (
                <div className="rounded-2xl p-5 bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
                  <p className="text-[15px] font-semibold text-black mb-2">{HOUSEHOLD_UI.leaveTitle}</p>
                  <p className="text-[13px]" style={{ color: 'rgba(0,0,0,0.55)' }}>
                    {HOUSEHOLD_UI.leaveBody}
                    {isOwner ? ` ${HOUSEHOLD_UI.leaveManagerNote}` : ''}
                  </p>
                  <div className="flex gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(false)}
                      className="flex-1 py-3 rounded-xl text-[14px] font-medium"
                      style={{ background: 'rgba(0,0,0,0.06)', color: '#000' }}
                    >
                      {HOUSEHOLD_UI.leaveStay}
                    </button>
                    <button
                      type="button"
                      onClick={handleLeave}
                      disabled={busy !== null}
                      className="flex-1 py-3 rounded-xl text-[14px] font-medium text-white disabled:opacity-40"
                      style={{ background: '#EF4444' }}
                    >
                      {leaveConfirmLabel(busy)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <BottomNav />
    </div>
  );
}
