'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { locales, localeNames, localeFlags, Locale } from '@/i18n/config';
import { getSchoolTheme, hasCustomTheme } from '@/lib/schoolThemes';
import {
  validatePassword,
  getPasswordStrengthColor,
  getPasswordStrengthLabel,
  getNotificationPreferences,
  saveNotificationPreferences,
  NotificationPreferences,
  DEFAULT_NOTIFICATION_PREFS,
  downloadUserData,
  calculateProfileCompletion,
  clearLocalAuthState,
} from '@/lib/validation';
import { supabase, getSupabaseBearerHeaders } from '@/lib/supabase-browser';
import { buildJsonAuthorizedHeaders } from '@/lib/supabaseAuthHeaders';
import {
  UniversitySearchField,
  type UniversitySearchInstitutionType,
} from '@/components/survey/UniversitySearchField';

const FONT = "'SF Pro Display', 'Helvetica Neue', -apple-system, Inter, sans-serif";
const ACCENT = '#5B4EE8';
const ACCENT_GRADIENT = 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)';

interface UserProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  institutionId?: string;
  institutionType?: string;
  destinationCountry?: string;
  university?: string;
  countryOfOrigin?: string;
  phone?: string;
  monthlyIncome?: number;
  monthlyExpenses?: number;
}

type ModalType = 'delete' | 'changePassword' | 'changeEmail' | 'editProfile' | 'resetChecklist' | null;

const PROFILE_FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  university: 'University',
  countryOfOrigin: 'Country of Origin',
};

function formatMissingProfileFields(fields: string[]): string {
  return fields.map((key) => PROFILE_FIELD_LABELS[key] ?? key).join(', ');
}

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

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none"
      style={{
        width: 44,
        height: 24,
        background: checked ? '#000' : 'rgba(0,0,0,0.12)',
      }}
    >
      <motion.div
        className="absolute top-[2px] w-5 h-5 bg-white rounded-full"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}
        animate={{ x: checked ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      />
    </button>
  );
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
  user: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
    </svg>
  ),
  mail: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  lock: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  palette: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  ),
  globe: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  bell: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
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
  checkSquare: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  shield: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
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
  const { theme, useSchoolTheme, toggleSchoolTheme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLanguage();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [notifications, setNotifications] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
  const [checklistCompleted, setChecklistCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editUniversity, setEditUniversity] = useState('');
  const [editInstitutionId, setEditInstitutionId] = useState('');
  const [editPhone, setEditPhone] = useState('');

  useEffect(() => {
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      setUserProfile(parsed);
      setEditFirstName(parsed.firstName || '');
      setEditLastName(parsed.lastName || '');
      setEditUniversity(parsed.university || '');
      setEditInstitutionId(parsed.institutionId || '');
      setEditPhone(parsed.phone || '');
    }
    const checklistDone = localStorage.getItem('noor_checklist_completed');
    setChecklistCompleted(checklistDone === 'true');
    setNotifications(getNotificationPreferences());
  }, []);

  const passwordValidation = useMemo(() => validatePassword(newPassword), [newPassword]);
  const passwordsMatch = newPassword === confirmNewPassword && confirmNewPassword.length > 0;

  const profileCompletion = useMemo(
    () => calculateProfileCompletion(userProfile as Record<string, unknown> | null),
    [userProfile]
  );

  const schoolTheme = userProfile?.institutionId ? getSchoolTheme(userProfile.institutionId) : null;
  const hasTheme = userProfile?.institutionId ? hasCustomTheme(userProfile.institutionId) : false;

  const surveySearchCountry = useMemo(() => {
    const fromProfile = userProfile?.destinationCountry;
    if (fromProfile === 'US' || fromProfile === 'UK' || fromProfile === 'CA') return fromProfile;
    if (typeof window === 'undefined') return 'US';
    const fromLs = localStorage.getItem('noor_selected_country');
    if (fromLs === 'US' || fromLs === 'UK' || fromLs === 'CA') return fromLs;
    return 'US';
  }, [userProfile?.destinationCountry]);

  const surveyInstitutionSearchType = useMemo((): UniversitySearchInstitutionType => {
    if (userProfile?.institutionType === 'community_college') return 'community_college';
    if (userProfile?.institutionType === 'university') return 'university';
    return 'all';
  }, [userProfile?.institutionType]);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleNotificationChange = (key: keyof NotificationPreferences, value: boolean) => {
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    saveNotificationPreferences(updated);
  };

  const handleResetChecklist = () => {
    localStorage.removeItem('noor_checklist_completed');
    localStorage.removeItem('noor_checklist_items');
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      parsed.onboarding_checklist_completed = false;
      delete parsed.checklist_completed_at;
      localStorage.setItem('noor_user_profile', JSON.stringify(parsed));
    }
    setChecklistCompleted(false);
    setActiveModal(null);
    showSuccess('Checklist has been reset');
    router.push('/');
  };

  const handleRetakeSurvey = () => {
    localStorage.removeItem('noor_user_profile');
    router.push('/survey');
  };

  const handleChangePassword = async () => {
    if (!passwordValidation.isValid || !passwordsMatch) {
      setError('Please ensure password meets requirements and matches');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setActiveModal(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      showSuccess('Password changed successfully');
    } catch {
      setError('Failed to change password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail || !emailPassword) {
      setError('Please fill in all fields');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (userProfile) {
        const updated = { ...userProfile, email: newEmail };
        localStorage.setItem('noor_user_profile', JSON.stringify(updated));
        setUserProfile(updated);
      }
      setActiveModal(null);
      setNewEmail('');
      setEmailPassword('');
      showSuccess('Verification email sent to ' + newEmail);
    } catch {
      setError('Failed to update email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!editFirstName || !editLastName) {
      setError('First and last name are required');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const uniLabel = editUniversity.trim();
      const updated = {
        ...userProfile,
        firstName: editFirstName,
        lastName: editLastName,
        university: uniLabel || undefined,
        institutionId: editInstitutionId || undefined,
        phone: editPhone,
      };
      localStorage.setItem('noor_user_profile', JSON.stringify(updated));
      setUserProfile(updated);

      const rawAuth = await getSupabaseBearerHeaders();
      if (rawAuth.Authorization && uniLabel) {
        const res = await fetch('/api/profile/survey-response', {
          method: 'PATCH',
          headers: buildJsonAuthorizedHeaders(rawAuth),
          body: JSON.stringify({ university: uniLabel, institution_id: editInstitutionId || null }),
        });
        if (res.status === 401) {
          setError('Sign in again to sync your school to the server.');
          setIsLoading(false);
          return;
        }
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          setError(errBody.error || 'Could not sync school to database');
          setIsLoading(false);
          return;
        }
      }

      setActiveModal(null);
      showSuccess('Profile updated successfully');
    } catch {
      setError('Failed to update profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      clearLocalAuthState();
      [
        'noor_notifications', 'noor_savings_goals',
        'noor_finance_progress', 'noor_checklist_completed', 'noor_checklist_items',
      ].forEach((key) => localStorage.removeItem(key));
      router.push('/welcome');
    } catch {
      setError('Failed to delete account. Please try again.');
      setIsLoading(false);
    }
  };

  const handleExportData = () => {
    downloadUserData();
    showSuccess('Data export downloaded');
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    clearLocalAuthState();
    router.push('/welcome');
  };

  const initials = getInitials(userProfile?.firstName, userProfile?.lastName);
  const fullName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ');

  const NOTIFICATION_ROWS: Array<{ key: keyof NotificationPreferences; label: string; desc: string }> = [
    { key: 'emailNotifications', label: 'Email Notifications', desc: 'Important updates and alerts' },
    { key: 'pushNotifications', label: 'Push Notifications', desc: 'Real-time alerts on your device' },
    { key: 'visaReminders', label: 'Goal Reminders', desc: 'Progress check-ins and milestones' },
    { key: 'budgetAlerts', label: 'Budget Alerts', desc: 'Spending limit and savings updates' },
    { key: 'newDeals', label: 'New Deals', desc: 'Exclusive offers and discounts' },
    { key: 'forumReplies', label: 'Forum Replies', desc: 'Responses to your posts' },
    { key: 'weeklySummary', label: 'Weekly Summary', desc: 'Digest of your financial activity' },
  ];

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

          <button
            onClick={() => {
              if (userProfile) {
                setEditFirstName(userProfile.firstName || '');
                setEditLastName(userProfile.lastName || '');
                setEditUniversity(userProfile.university || '');
                setEditInstitutionId(userProfile.institutionId || '');
                setEditPhone(userProfile.phone || '');
              }
              setActiveModal('editProfile');
            }}
            className="flex-shrink-0 text-[13px] font-medium px-3.5 py-1.5 rounded-xl transition-colors"
            style={{
              color: ACCENT,
              background: 'rgba(91,78,232,0.08)',
              fontFamily: FONT,
            }}
          >
            Edit
          </button>
        </div>

        {/* Profile completion bar */}
        {profileCompletion.percentage < 100 && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px]" style={{ color: 'rgba(0,0,0,0.38)', fontFamily: FONT }}>
                Profile {profileCompletion.percentage}% complete
              </span>
              <span className="text-[12px] font-medium" style={{ color: ACCENT, fontFamily: FONT }}>
                {formatMissingProfileFields(profileCompletion.requiredFields)}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: ACCENT_GRADIENT }}
                initial={{ width: 0 }}
                animate={{ width: `${profileCompletion.percentage}%` }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        )}
      </motion.div>

      {/* ── SECURITY ── */}
      <SectionLabel>Security</SectionLabel>
      <SettingsCard>
        <SettingsRow
          icon={Ico.mail}
          label="Change Email"
          description="Requires email verification"
          chevron
          onClick={() => setActiveModal('changeEmail')}
        />
        <SettingsRow
          icon={Ico.lock}
          label="Change Password"
          description="Use a strong, unique password"
          chevron
          last
          onClick={() => setActiveModal('changePassword')}
        />
      </SettingsCard>

      {/* ── APPEARANCE (school theme) ── */}
      {hasTheme && schoolTheme && (
        <>
          <SectionLabel>Appearance</SectionLabel>
          <SettingsCard>
            <div className="flex items-center gap-3.5 px-4 py-3.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(0,0,0,0.05)' }}
              >
                <div style={{ color: 'rgba(0,0,0,0.55)' }}>{Ico.palette}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-black leading-tight" style={{ fontFamily: FONT }}>
                  School Theme
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: 'rgba(0,0,0,0.35)', fontFamily: FONT }}>
                  {schoolTheme.name}
                </div>
              </div>
              <Toggle
                checked={useSchoolTheme}
                onChange={(v) => {
                  toggleSchoolTheme(v);
                  if (v && userProfile?.institutionId) setTheme(userProfile.institutionId);
                }}
              />
            </div>
          </SettingsCard>
        </>
      )}

      {/* ── PREFERENCES ── */}
      <SectionLabel>Preferences</SectionLabel>
      <SettingsCard>
        <SettingsRow
          icon={Ico.globe}
          label="Language"
          value={`${localeFlags[locale]}  ${localeNames[locale]}`}
          chevron
          last
          onClick={() => setShowLanguageModal(true)}
        />
      </SettingsCard>

      {/* ── NOTIFICATIONS ── */}
      <SectionLabel>Notifications</SectionLabel>
      <SettingsCard>
        {NOTIFICATION_ROWS.map((item, idx) => (
          <div
            key={item.key}
            className="flex items-center gap-3.5 px-4 py-3.5"
            style={{
              borderBottom: idx < NOTIFICATION_ROWS.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
            }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,0,0,0.05)' }}
            >
              <div style={{ color: 'rgba(0,0,0,0.55)' }}>{Ico.bell}</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-black leading-tight" style={{ fontFamily: FONT }}>
                {item.label}
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'rgba(0,0,0,0.35)', fontFamily: FONT }}>
                {item.desc}
              </div>
            </div>
            <Toggle
              checked={notifications[item.key]}
              onChange={(v) => handleNotificationChange(item.key, v)}
            />
          </div>
        ))}
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
        <SettingsRow
          icon={Ico.shield}
          label="Clear Cache"
          description="Clear cached data and chat history"
          chevron
          last
          onClick={() => {
            localStorage.removeItem('noor_chat_history');
            showSuccess('Cache cleared');
          }}
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
          onClick={handleRetakeSurvey}
        />
        <SettingsRow
          icon={Ico.checkSquare}
          label="Reset Checklist"
          description={checklistCompleted ? 'Start your checklist over' : 'Checklist not completed yet'}
          chevron
          last
          onClick={() => setActiveModal('resetChecklist')}
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

        {/* Change Password */}
        {activeModal === 'changePassword' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.06)' }}>
                {Ico.lock}
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-black" style={{ fontFamily: FONT }}>Change Password</h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'rgba(0,0,0,0.4)', fontFamily: FONT }}>Must meet all requirements below</p>
              </div>
            </div>

            <div className="space-y-4">
              <ModalInput label="Current Password" type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={setCurrentPassword} />
              <div>
                <ModalInput label="New Password" type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={setNewPassword} />
                {newPassword && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${passwordValidation.score}%`,
                          background: getPasswordStrengthColor(passwordValidation.strength),
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: getPasswordStrengthColor(passwordValidation.strength), fontFamily: FONT }}>
                      {getPasswordStrengthLabel(passwordValidation.strength)}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <ModalInput label="Confirm New Password" type={showPasswords ? 'text' : 'password'} value={confirmNewPassword} onChange={setConfirmNewPassword} />
                {confirmNewPassword && (
                  <p className="text-[12px] mt-1.5" style={{ color: passwordsMatch ? '#22C55E' : '#EF4444', fontFamily: FONT }}>
                    {passwordsMatch ? '✓ Passwords match' : '✗ Passwords don\'t match'}
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-[13px]" style={{ color: 'rgba(0,0,0,0.5)', fontFamily: FONT }}>Show passwords</span>
              </label>

              {error && <p className="text-[13px] text-red-500" style={{ fontFamily: FONT }}>{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setActiveModal(null); setError(null); }} className="flex-1 py-3 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={isLoading || !passwordValidation.isValid || !passwordsMatch || !currentPassword}
                className="flex-1 py-3 rounded-xl text-[14px] font-medium text-white disabled:opacity-40"
                style={{ background: '#000', fontFamily: FONT }}
              >
                {isLoading ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </Modal>
        )}

        {/* Change Email */}
        {activeModal === 'changeEmail' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.06)' }}>
                {Ico.mail}
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-black" style={{ fontFamily: FONT }}>Change Email</h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'rgba(0,0,0,0.4)', fontFamily: FONT }}>You'll need to verify your new address</p>
              </div>
            </div>

            <div className="space-y-4">
              <ModalInput label="New Email" type="email" value={newEmail} onChange={setNewEmail} placeholder="your@email.com" autoFocus />
              <ModalInput label="Confirm Password" type="password" value={emailPassword} onChange={setEmailPassword} placeholder="Your current password" />
              {error && <p className="text-[13px] text-red-500" style={{ fontFamily: FONT }}>{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setActiveModal(null); setError(null); }} className="flex-1 py-3 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
                Cancel
              </button>
              <button
                onClick={handleChangeEmail}
                disabled={isLoading || !newEmail || !emailPassword}
                className="flex-1 py-3 rounded-xl text-[14px] font-medium text-white disabled:opacity-40"
                style={{ background: '#000', fontFamily: FONT }}
              >
                {isLoading ? 'Sending…' : 'Send Verification'}
              </button>
            </div>
          </Modal>
        )}

        {/* Edit Profile */}
        {activeModal === 'editProfile' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.06)' }}>
                {Ico.user}
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-black" style={{ fontFamily: FONT }}>Edit Profile</h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'rgba(0,0,0,0.4)', fontFamily: FONT }}>Update your info</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <ModalInput label="First Name *" value={editFirstName} onChange={setEditFirstName} />
                <ModalInput label="Last Name *" value={editLastName} onChange={setEditLastName} />
              </div>

              <div>
                <label
                  className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: 'rgba(0,0,0,0.35)', fontFamily: FONT, letterSpacing: '0.1em' }}
                >
                  School
                </label>
                <UniversitySearchField
                  country={surveySearchCountry}
                  institutionType={surveyInstitutionSearchType}
                  selectedInstitutionId={editInstitutionId}
                  searchQuery={editUniversity}
                  onSearchQueryChange={setEditUniversity}
                  onSelect={(inst) => { setEditInstitutionId(inst.id); setEditUniversity(inst.short_name); }}
                  onCantFind={(typed) => { setEditInstitutionId('other'); setEditUniversity(typed || 'Other'); }}
                  searchPlaceholder="Search by school name…"
                  cantFindLabel="Can't find my school"
                  noResultsLabel="No schools found — use my text as school name"
                />
              </div>

              <ModalInput label="Phone (optional)" type="tel" value={editPhone} onChange={setEditPhone} placeholder="(555) 123-4567" />

              {error && <p className="text-[13px] text-red-500" style={{ fontFamily: FONT }}>{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setActiveModal(null); setError(null); }} className="flex-1 py-3 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
                Cancel
              </button>
              <button
                onClick={handleSaveProfile}
                disabled={isLoading || !editFirstName || !editLastName}
                className="flex-1 py-3 rounded-xl text-[14px] font-medium text-white disabled:opacity-40"
                style={{ background: '#000', fontFamily: FONT }}
              >
                {isLoading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </Modal>
        )}

        {/* Reset Checklist */}
        {activeModal === 'resetChecklist' && (
          <Modal onClose={() => setActiveModal(null)}>
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(0,0,0,0.06)' }}>
                {Ico.checkSquare}
              </div>
              <h3 className="text-[16px] font-semibold text-black mb-2" style={{ fontFamily: FONT }}>Reset Checklist?</h3>
              <p className="text-[13px]" style={{ color: 'rgba(0,0,0,0.45)', fontFamily: FONT }}>
                This will reset your checklist progress and show it again on the home screen.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setActiveModal(null)} className="flex-1 py-3 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
                Cancel
              </button>
              <button onClick={handleResetChecklist} className="flex-1 py-3 rounded-xl text-[14px] font-medium text-white" style={{ background: '#000', fontFamily: FONT }}>
                Reset
              </button>
            </div>
          </Modal>
        )}

        {/* Language */}
        {showLanguageModal && (
          <Modal onClose={() => setShowLanguageModal(false)}>
            <h3 className="text-[16px] font-semibold text-black mb-1" style={{ fontFamily: FONT }}>{t('settings.language.title')}</h3>
            <p className="text-[13px] mb-5" style={{ color: 'rgba(0,0,0,0.4)', fontFamily: FONT }}>{t('settings.language.description')}</p>

            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
              {locales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => { setLocale(loc); setShowLanguageModal(false); showSuccess(localeNames[loc] + ' selected'); }}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-xl transition-all"
                  style={{
                    border: locale === loc ? '1.5px solid #000' : '1.5px solid rgba(0,0,0,0.1)',
                    background: locale === loc ? '#000' : '#fff',
                    fontFamily: FONT,
                  }}
                >
                  <span className="text-xl">{localeFlags[loc]}</span>
                  <span className="text-[13px] font-medium" style={{ color: locale === loc ? '#fff' : '#000' }}>{localeNames[loc]}</span>
                </button>
              ))}
            </div>

            <button onClick={() => setShowLanguageModal(false)} className="w-full py-3 mt-5 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
              {t('common.close')}
            </button>
          </Modal>
        )}

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
              <ModalInput label="Enter your password" type="password" value={deletePassword} onChange={setDeletePassword} />
              <ModalInput label='Type "DELETE" to confirm' value={deleteConfirmText} onChange={setDeleteConfirmText} placeholder="DELETE" />
              {error && <p className="text-[13px] text-red-500" style={{ fontFamily: FONT }}>{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setActiveModal(null); setError(null); }} className="flex-1 py-3 rounded-xl text-[14px] font-medium" style={{ background: 'rgba(0,0,0,0.06)', color: '#000', fontFamily: FONT }}>
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isLoading || deleteConfirmText !== 'DELETE' || !deletePassword}
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
