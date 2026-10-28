'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import {
  clearLocalAuthState,
  purgeAllNoorLocalState,
} from '@/lib/validation';
import { supabase, getSupabaseBearerHeaders } from '@/lib/supabase-browser';
import { buildJsonAuthorizedHeaders, buildBearerOnlyHeaders } from '@/lib/supabaseAuthHeaders';

const FONT = "'SF Pro Display', 'Helvetica Neue', -apple-system, Inter, sans-serif";
const ACCENT = '#5B4EE8';
const ACCENT_GRADIENT = 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)';

interface UserProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
}

type ModalType = 'delete' | null;

function getInitials(firstName?: string, lastName?: string): string {
  const f = firstName?.trim()?.[0]?.toUpperCase() ?? '';
  const l = lastName?.trim()?.[0]?.toUpperCase() ?? '';
  return (f + l) || '?';
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 pt-7 pb-2">
      <span
        className="text-[11px] font-semibold tracking-widest uppercase"
        style={{ color: 'rgba(0,0,0,0.28)', fontFamily: FONT, letterSpacing: '0.12em' }}
      >
        {children}
      </span>
    </div>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-4 rounded-2xl overflow-hidden"
      style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)' }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div className="mx-4" style={{ height: '1px', background: 'rgba(0,0,0,0.05)' }} />;
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  description?: string;
  value?: string;
  chevron?: boolean;
  danger?: boolean;
  onClick?: () => void;
  right?: React.ReactNode;
  last?: boolean;
}

function SettingsRow({ icon, label, description, value, chevron, danger, onClick, right, last }: RowProps) {
  const inner = (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: danger ? 'rgba(239,68,68,0.08)' : 'rgba(0,0,0,0.05)' }}
      >
        <div style={{ color: danger ? '#EF4444' : 'rgba(0,0,0,0.55)' }}>{icon}</div>
      </div>

      <div className="flex-1 min-w-0">
        <div
          className="text-[14px] font-medium leading-tight truncate"
          style={{ color: danger ? '#EF4444' : '#000', fontFamily: FONT }}
        >
          {label}
        </div>
        {description && (
          <div
            className="text-[12px] mt-0.5 truncate"
            style={{ color: 'rgba(0,0,0,0.35)', fontFamily: FONT }}
          >
            {description}
          </div>
        )}
      </div>

      {right && <div className="flex-shrink-0 ml-2">{right}</div>}

      {value && !right && (
        <span
          className="text-[13px] flex-shrink-0 ml-2"
          style={{ color: 'rgba(0,0,0,0.35)', fontFamily: FONT }}
        >
          {value}
        </span>
      )}

      {chevron && (
        <svg
          className="w-4 h-4 flex-shrink-0 ml-1"
          style={{ color: 'rgba(0,0,0,0.18)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );

  const base = `w-full text-left transition-colors active:bg-black/[0.03] ${!last ? 'border-b border-black/[0.05]' : ''}`;

  return onClick ? (
    <button onClick={onClick} className={base} style={{ display: 'block' }}>
      {inner}
    </button>
  ) : (
    <div className={last ? '' : 'border-b border-black/[0.05]'}>{inner}</div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

const Ico = {
  lock: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  download: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  trash: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  clipboard: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

// ── Modal ──────────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ fontFamily: FONT }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function ModalInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label
        className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: 'rgba(0,0,0,0.35)', fontFamily: FONT, letterSpacing: '0.1em' }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all"
        style={{
          background: 'rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.08)',
          color: '#000',
          fontFamily: FONT,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = ACCENT;
          e.currentTarget.style.boxShadow = `0 0 0 3px rgba(91,78,232,0.1)`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Page-level error toast. `error` above is only rendered INSIDE modals, so
  // failures from page-level actions (e.g. data export) must surface here or
  // they are silent.
  const [toastError, setToastError] = useState<string | null>(null);

  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      setUserProfile(JSON.parse(profile));
    }
  }, []);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // Visible counterpart to showSuccess for page-level (non-modal) failures.
  const showError = (message: string) => {
    setToastError(message);
    setTimeout(() => setToastError(null), 4000);
  };

  // The cached profile is deliberately left in place. The survey merges its
  // result over this key on submit rather than replacing it, so clearing it up
  // front buys nothing and costs the survey prefill, which reads the same cache.
  const handleRetakeSurvey = () => {
    router.push('/survey');
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // Deletion authenticates via the Bearer token only — no password gate.
      // A password check breaks OAuth users (who have no password), and the
      // token already proves identity account-type-neutrally.
      const rawAuth = await getSupabaseBearerHeaders();
      if (!rawAuth.Authorization) {
        setError('Your session has expired. Please sign in again to delete your account.');
        setIsLoading(false);
        return;
      }

      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: buildJsonAuthorizedHeaders(rawAuth),
      });

      if (!res.ok) {
        // Surface the server's explicit error — never let the user believe the
        // account was deleted when it was not (or was only half-deleted).
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errBody.error || 'Failed to delete account. Please try again.');
        setIsLoading(false);
        return;
      }

      // Server returned 200 = deletion is complete. Nothing after this point
      // may surface as a deletion failure. signOut() can legitimately fail
      // (the auth user is already deleted, so the server call may 4xx) — that
      // is a normal outcome, not a deletion failure, so we swallow it. Local
      // purge and navigation run unconditionally.
      try {
        if (supabase) await supabase.auth.signOut();
      } catch (err) {
        console.warn('handleDeleteAccount: signOut after deletion failed (expected — user already deleted):', err);
      }
      purgeAllNoorLocalState();
      router.push('/welcome');
    } catch {
      setError('Failed to delete account. Please try again.');
      setIsLoading(false);
    }
  };

  const handleExportData = async () => {
    // GDPR export must come from the server (DB: chat history, user_facts,
    // survey responses, etc.) — NOT the legacy localStorage dump. Identity is
    // proven by the Bearer token; the server filters everything by that id.
    setIsLoading(true);
    // Export is triggered from a page row, not a modal, so failures must use
    // the page-level toast (showError) — the modal-only `error` state would be
    // invisible here.
    try {
      const rawAuth = await getSupabaseBearerHeaders();
      if (!rawAuth.Authorization) {
        showError('Your session has expired. Please sign in again to export your data.');
        return;
      }

      const res = await fetch('/api/account/export', {
        method: 'GET',
        headers: buildBearerOnlyHeaders(rawAuth),
      });

      if (!res.ok) {
        // Surface the server's explicit error — never a silent no-op.
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        showError(errBody.error || 'Failed to export your data. Please try again.');
        return;
      }

      // fetch() does not honor the response's Content-Disposition, so trigger
      // the download client-side. Filename matches the server header.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'noor-data-export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showSuccess('Data export downloaded');
    } catch {
      showError('Failed to export your data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    clearLocalAuthState();
    router.push('/welcome');
  };

  const initials = getInitials(userProfile?.firstName, userProfile?.lastName);
  const fullName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ');

  return (
    <div className="min-h-screen pb-28" style={{ background: '#F5F5F5', fontFamily: FONT }}>

      {/* ── STICKY HEADER ── */}
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
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ background: 'rgba(0,0,0,0.06)' }}
          >
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-[17px] font-semibold text-black tracking-tight" style={{ fontFamily: FONT }}>
            Settings
          </h1>
        </div>
      </div>

      {/* ── SUCCESS TOAST ── */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 left-4 right-4 z-50"
          >
            <div
              className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-white text-[13px] font-medium shadow-lg"
              style={{ background: '#111', fontFamily: FONT }}
            >
              <svg className="w-4 h-4 flex-shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {successMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ERROR TOAST (page-level actions) ── */}
      <AnimatePresence>
        {toastError && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 left-4 right-4 z-50"
          >
            <div
              className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-white text-[13px] font-medium shadow-lg"
              style={{ background: '#7F1D1D', fontFamily: FONT }}
            >
              <svg className="w-4 h-4 flex-shrink-0 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M12 3l9 16H3L12 3z" />
              </svg>
              {toastError}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PROFILE HERO CARD ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mx-4 mt-5 rounded-2xl p-5"
        style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)' }}
      >
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div
            className="w-[54px] h-[54px] rounded-full flex items-center justify-center flex-shrink-0 text-white text-[20px] font-semibold"
            style={{ background: ACCENT_GRADIENT, fontFamily: FONT }}
          >
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <div
              className="text-[16px] font-semibold text-black truncate leading-tight"
              style={{ fontFamily: FONT }}
            >
              {fullName || 'Your Profile'}
            </div>
            <div
              className="text-[13px] truncate mt-0.5"
              style={{ color: 'rgba(0,0,0,0.38)', fontFamily: FONT }}
            >
              {userProfile?.email || 'No email set'}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── SECURITY ── */}
      {/* Password changes go through the email reset flow; there is no
          in-app change that verifies the current password. */}
      <SectionLabel>Security</SectionLabel>
      <SettingsCard>
        <SettingsRow
          icon={Ico.lock}
          label="Change Password"
          description="We'll email you a reset link"
          chevron
          last
          onClick={() => router.push('/forgot-password')}
        />
      </SettingsCard>

      {/* ── DATA & PRIVACY ── */}
      <SectionLabel>Data &amp; Privacy</SectionLabel>
      <SettingsCard>
        <SettingsRow
          icon={Ico.download}
          label="Export My Data"
          description="Download everything (GDPR)"
          chevron
          onClick={handleExportData}
        />
      </SettingsCard>

      {/* ── ACCOUNT ── */}
      <SectionLabel>Account</SectionLabel>
      <SettingsCard>
        <SettingsRow
          icon={Ico.clipboard}
          label="Retake Survey"
          description="Update your financial profile"
          chevron
          last
          onClick={handleRetakeSurvey}
        />
      </SettingsCard>

      {/* ── SIGN OUT ── */}
      <div className="mx-4 mt-6">
        <motion.button
          onClick={handleLogout}
          className="w-full py-3.5 rounded-2xl text-[14px] font-medium transition-colors"
          style={{
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.1)',
            color: '#000',
            fontFamily: FONT,
          }}
          whileTap={{ scale: 0.98 }}
        >
          Sign Out
        </motion.button>
      </div>

      {/* ── DANGER ZONE ── */}
      <SectionLabel>Danger Zone</SectionLabel>
      <SettingsCard>
        <SettingsRow
          icon={Ico.warning}
          label="Delete Account"
          description="Permanently remove all your data"
          chevron
          danger
          last
          onClick={() => setActiveModal('delete')}
        />
      </SettingsCard>

      {/* ── VERSION ── */}
      <p
        className="text-center text-[11px] pt-7 pb-3"
        style={{ color: 'rgba(0,0,0,0.2)', fontFamily: FONT }}
      >
        Noor v1.0.0 · Made for your financial journey
      </p>

      {/* ── MODALS ── */}
      <AnimatePresence>

        {/* Delete Account */}
        {activeModal === 'delete' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <div style={{ color: '#EF4444' }}>{Ico.warning}</div>
              </div>
              <h3 className="text-[16px] font-semibold text-black mb-2" style={{ fontFamily: FONT }}>Delete Account?</h3>
              <p className="text-[13px]" style={{ color: 'rgba(0,0,0,0.45)', fontFamily: FONT }}>
                This permanently deletes all your data — saved preferences, chat history, and survey responses.{' '}
                <strong style={{ color: '#000' }}>This cannot be undone.</strong>
              </p>
            </div>

            <div className="space-y-4">
              <ModalInput label='Type "DELETE" to confirm' value={deleteConfirmText} onChange={setDeleteConfirmText} placeholder="DELETE" autoFocus />
              {error && <p className="text-[13px] text-red-500" style={{ fontFamily: FONT }}>{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setActiveModal(null); setError(null); }} className="flex-1 py-3 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isLoading || deleteConfirmText !== 'DELETE'}
                className="flex-1 py-3 rounded-xl text-[14px] font-medium text-white disabled:opacity-40"
                style={{ background: '#EF4444', fontFamily: FONT }}
              >
                {isLoading ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </Modal>
        )}

      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
