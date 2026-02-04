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
  clearSession,
} from '@/lib/validation';

interface UserProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  institutionId?: string;
  university?: string;
  countryOfOrigin?: string;
  phone?: string;
  monthlyIncome?: number;
  monthlyExpenses?: number;
}

type ModalType = 'delete' | 'changePassword' | 'changeEmail' | 'editProfile' | 'resetChecklist' | null;

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

  // Password change form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  // Email change form
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  // Delete account form
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Profile edit form
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  useEffect(() => {
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      setUserProfile(parsed);
      setEditFirstName(parsed.firstName || '');
      setEditLastName(parsed.lastName || '');
      setEditPhone(parsed.phone || '');
    }

    const checklistDone = localStorage.getItem('noor_checklist_completed');
    setChecklistCompleted(checklistDone === 'true');

    // Load notification preferences from localStorage
    setNotifications(getNotificationPreferences());
  }, []);

  // Password validation
  const passwordValidation = useMemo(() => {
    return validatePassword(newPassword);
  }, [newPassword]);

  const passwordsMatch = newPassword === confirmNewPassword && confirmNewPassword.length > 0;

  // Profile completion
  const profileCompletion = useMemo(() => {
    return calculateProfileCompletion(userProfile as Record<string, unknown> | null);
  }, [userProfile]);

  const schoolTheme = userProfile?.institutionId
    ? getSchoolTheme(userProfile.institutionId)
    : null;

  const hasTheme = userProfile?.institutionId
    ? hasCustomTheme(userProfile.institutionId)
    : false;

  // Show success message with auto-dismiss
  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // Notification toggles
  const handleNotificationChange = (key: keyof NotificationPreferences, value: boolean) => {
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    saveNotificationPreferences(updated);
  };

  // Reset checklist
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

  // Retake survey
  const handleRetakeSurvey = () => {
    localStorage.removeItem('noor_user_profile');
    router.push('/survey');
  };

  // Change password
  const handleChangePassword = async () => {
    if (!passwordValidation.isValid || !passwordsMatch) {
      setError('Please ensure password meets requirements and matches');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // In production: await fetch('/api/change-password', { ... })

      setActiveModal(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      showSuccess('Password changed successfully');
    } catch (err) {
      setError('Failed to change password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Change email
  const handleChangeEmail = async () => {
    if (!newEmail || !emailPassword) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update local profile
      if (userProfile) {
        const updated = { ...userProfile, email: newEmail };
        localStorage.setItem('noor_user_profile', JSON.stringify(updated));
        setUserProfile(updated);
      }

      setActiveModal(null);
      setNewEmail('');
      setEmailPassword('');
      showSuccess('Verification email sent to ' + newEmail);
    } catch (err) {
      setError('Failed to update email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Edit profile
  const handleSaveProfile = async () => {
    if (!editFirstName || !editLastName) {
      setError('First and last name are required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const updated = {
        ...userProfile,
        firstName: editFirstName,
        lastName: editLastName,
        phone: editPhone,
      };
      localStorage.setItem('noor_user_profile', JSON.stringify(updated));
      setUserProfile(updated);

      setActiveModal(null);
      showSuccess('Profile updated successfully');
    } catch (err) {
      setError('Failed to update profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete account
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clear all user data
      const keysToRemove = [
        'noor_user_id',
        'noor_user_profile',
        'noor_notifications',
        'noor_chat_history',
        'noor_session',
        'noor_savings_goals',
        'noor_finance_progress',
        'noor_checklist_completed',
        'noor_checklist_items',
      ];
      keysToRemove.forEach(key => localStorage.removeItem(key));

      clearSession();
      router.push('/welcome');
    } catch (err) {
      setError('Failed to delete account. Please try again.');
      setIsLoading(false);
    }
  };

  // Export data
  const handleExportData = () => {
    downloadUserData();
    showSuccess('Data export downloaded');
  };

  // Logout
  const handleLogout = () => {
    clearSession();
    localStorage.removeItem('noor_user_id');
    localStorage.removeItem('noor_user_profile');
    router.push('/welcome');
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div
        className="border-b border-[#E8E6E3]"
        style={{
          backgroundColor: useSchoolTheme ? theme.primary_color : '#FFFFFF',
        }}
      >
        <div className="px-6 py-4">
          <button
            onClick={() => router.back()}
            className="mb-2"
            style={{ color: useSchoolTheme ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000') : '#6B6B6B' }}
          >
            ← Back
          </button>
          <h1
            className="text-2xl font-light tracking-tight"
            style={{ color: useSchoolTheme ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000') : '#1A1A1A' }}
          >
            Settings
          </h1>
        </div>
      </div>

      {/* Success Message */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-4 right-4 z-50"
          >
            <div className="bg-emerald-500 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {successMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 py-6 space-y-4">
        {/* Profile Completion */}
        {profileCompletion.percentage < 100 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-blue-900">Complete Your Profile</h3>
              <span className="text-sm font-medium text-blue-600">{profileCompletion.percentage}%</span>
            </div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-blue-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${profileCompletion.percentage}%` }}
              />
            </div>
            {profileCompletion.requiredFields.length > 0 && (
              <p className="text-xs text-blue-700 mt-2">
                Missing: {profileCompletion.requiredFields.join(', ')}
              </p>
            )}
          </motion.div>
        )}

        {/* Profile Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium text-[#1A1A1A]">Profile</h3>
            <button
              onClick={() => setActiveModal('editProfile')}
              className="text-xs text-blue-600 hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
              <span className="text-sm text-[#6B6B6B]">Name</span>
              <span className="text-sm text-[#1A1A1A]">
                {userProfile?.firstName} {userProfile?.lastName}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
              <span className="text-sm text-[#6B6B6B]">Email</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#1A1A1A]">{userProfile?.email}</span>
                {userProfile?.email?.endsWith('.edu') && (
                  <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">.edu</span>
                )}
              </div>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[#6B6B6B]">School</span>
              <span className="text-sm text-[#1A1A1A]">{userProfile?.university || 'Not set'}</span>
            </div>
          </div>
        </motion.div>

        {/* Account Security Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Account Security</h3>
          <div className="space-y-3">
            <button
              onClick={() => setActiveModal('changeEmail')}
              className="w-full flex justify-between items-center py-2 border-b border-[#E8E6E3] text-left"
            >
              <div>
                <span className="text-sm text-[#1A1A1A]">Change Email</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Requires verification</p>
              </div>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
            <button
              onClick={() => setActiveModal('changePassword')}
              className="w-full flex justify-between items-center py-2 text-left"
            >
              <div>
                <span className="text-sm text-[#1A1A1A]">Change Password</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Use a strong, unique password</p>
              </div>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
          </div>
        </motion.div>

        {/* School Theme Section */}
        {hasTheme && schoolTheme && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[#1A1A1A]">School Theme</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSchoolTheme}
                  onChange={(e) => {
                    toggleSchoolTheme(e.target.checked);
                    if (e.target.checked && userProfile?.institutionId) {
                      setTheme(userProfile.institutionId);
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
              </label>
            </div>

            <div
              className="p-4 rounded-xl flex items-center gap-4"
              style={{ backgroundColor: useSchoolTheme ? schoolTheme.primary_color : '#F5F4F2' }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-medium"
                style={{ backgroundColor: schoolTheme.secondary_color, color: schoolTheme.primary_color }}
              >
                {schoolTheme.short_name.charAt(0)}
              </div>
              <div>
                <p
                  className="font-medium"
                  style={{ color: useSchoolTheme ? (schoolTheme.text_on_primary === 'white' ? '#FFFFFF' : '#000000') : '#1A1A1A' }}
                >
                  {schoolTheme.name}
                </p>
                <p
                  className="text-xs"
                  style={{ color: useSchoolTheme ? (schoolTheme.text_on_primary === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)') : '#6B6B6B' }}
                >
                  {schoolTheme.mascot || 'School colors'}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Language Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">{t('settings.language.title')}</h3>
          <button
            onClick={() => setShowLanguageModal(true)}
            className="w-full flex justify-between items-center py-2 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{localeFlags[locale]}</span>
              <div>
                <span className="text-sm text-[#1A1A1A]">{localeNames[locale]}</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">{t('settings.language.description')}</p>
              </div>
            </div>
            <span className="text-sm text-[#1A1A1A]">→</span>
          </button>
        </motion.div>

        {/* Notifications Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">{t('settings.notifications.title')}</h3>
          <div className="space-y-3">
            {[
              { key: 'emailNotifications', label: 'Email Notifications', desc: 'Important updates and alerts' },
              { key: 'pushNotifications', label: 'Push Notifications', desc: 'Real-time alerts on your device' },
              { key: 'visaReminders', label: 'Visa Reminders', desc: 'Deadline and status notifications' },
              { key: 'budgetAlerts', label: 'Budget Alerts', desc: 'Spending and savings updates' },
              { key: 'newDeals', label: 'New Deals', desc: 'Student discounts and offers' },
              { key: 'forumReplies', label: 'Forum Replies', desc: 'Responses to your posts' },
              { key: 'weeklySummary', label: 'Weekly Summary', desc: 'Digest of your activity' },
            ].map((item, idx) => (
              <div
                key={item.key}
                className={`flex justify-between items-center py-2 ${idx < 6 ? 'border-b border-[#E8E6E3]' : ''}`}
              >
                <div>
                  <span className="text-sm text-[#1A1A1A]">{item.label}</span>
                  <p className="text-xs text-[#9B9B9B] mt-0.5">{item.desc}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifications[item.key as keyof NotificationPreferences]}
                    onChange={(e) => handleNotificationChange(item.key as keyof NotificationPreferences, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
                </label>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Data & Privacy Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Data & Privacy</h3>
          <div className="space-y-3">
            <button
              onClick={handleExportData}
              className="w-full flex justify-between items-center py-2 border-b border-[#E8E6E3] text-left"
            >
              <div>
                <span className="text-sm text-[#1A1A1A]">Export My Data</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Download all your data (GDPR)</p>
              </div>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('noor_chat_history');
                showSuccess('Cache cleared');
              }}
              className="w-full flex justify-between items-center py-2 text-left"
            >
              <div>
                <span className="text-sm text-[#1A1A1A]">Clear Cache</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Clear cached data and chat history</p>
              </div>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
          </div>
        </motion.div>

        {/* Account Actions Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Account</h3>
          <div className="space-y-3">
            <button
              onClick={handleRetakeSurvey}
              className="w-full flex justify-between items-center py-2 border-b border-[#E8E6E3] text-left"
            >
              <div>
                <span className="text-sm text-[#1A1A1A]">Retake Survey</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Update your preferences and visa info</p>
              </div>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
            <button
              onClick={() => setActiveModal('resetChecklist')}
              className="w-full flex justify-between items-center py-2 border-b border-[#E8E6E3] text-left"
            >
              <div>
                <span className="text-sm text-[#1A1A1A]">Reset Checklist</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">
                  {checklistCompleted ? 'Start your first week checklist again' : 'Checklist not completed yet'}
                </p>
              </div>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
            <button
              onClick={() => setActiveModal('delete')}
              className="w-full flex justify-between items-center py-2 text-left"
            >
              <div>
                <span className="text-sm text-red-500">Delete Account</span>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Permanently remove all your data</p>
              </div>
              <span className="text-sm text-red-500">→</span>
            </button>
          </div>
        </motion.div>

        {/* Logout Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <button
            onClick={handleLogout}
            className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-medium text-sm"
          >
            Sign Out
          </button>
        </motion.div>

        {/* Version Info */}
        <p className="text-center text-xs text-[#9B9B9B] pt-4">
          Noor v1.0.0 • Made with care for international students
        </p>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {/* Change Password Modal */}
        {activeModal === 'changePassword' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <h3 className="text-lg font-medium text-[#1A1A1A] mb-2">Change Password</h3>
            <p className="text-sm text-[#6B6B6B] mb-6">Your new password must meet all requirements.</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#6B6B6B]">Current Password</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-[#6B6B6B]">New Password</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
                {newPassword && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${passwordValidation.score}%`,
                            backgroundColor: getPasswordStrengthColor(passwordValidation.strength),
                          }}
                        />
                      </div>
                      <span className="text-xs" style={{ color: getPasswordStrengthColor(passwordValidation.strength) }}>
                        {getPasswordStrengthLabel(passwordValidation.strength)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-[#6B6B6B]">Confirm New Password</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
                {confirmNewPassword && (
                  <p className={`text-xs mt-1 ${passwordsMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                    {passwordsMatch ? '✓ Passwords match' : '✗ Passwords don\'t match'}
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-[#6B6B6B]">
                <input
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                />
                Show passwords
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setActiveModal(null); setError(null); }}
                className="flex-1 py-3 bg-gray-100 text-[#1A1A1A] rounded-xl font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={isLoading || !passwordValidation.isValid || !passwordsMatch || !currentPassword}
                className="flex-1 py-3 bg-black text-white rounded-xl font-medium text-sm disabled:opacity-50"
              >
                {isLoading ? 'Saving...' : 'Update Password'}
              </button>
            </div>
          </Modal>
        )}

        {/* Change Email Modal */}
        {activeModal === 'changeEmail' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <h3 className="text-lg font-medium text-[#1A1A1A] mb-2">Change Email</h3>
            <p className="text-sm text-[#6B6B6B] mb-6">You'll need to verify your new email address.</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#6B6B6B]">New Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-[#6B6B6B]">Confirm Password</label>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="Your current password"
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setActiveModal(null); setError(null); }}
                className="flex-1 py-3 bg-gray-100 text-[#1A1A1A] rounded-xl font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleChangeEmail}
                disabled={isLoading || !newEmail || !emailPassword}
                className="flex-1 py-3 bg-black text-white rounded-xl font-medium text-sm disabled:opacity-50"
              >
                {isLoading ? 'Sending...' : 'Send Verification'}
              </button>
            </div>
          </Modal>
        )}

        {/* Edit Profile Modal */}
        {activeModal === 'editProfile' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <h3 className="text-lg font-medium text-[#1A1A1A] mb-2">Edit Profile</h3>
            <p className="text-sm text-[#6B6B6B] mb-6">Update your profile information.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#6B6B6B]">First Name *</label>
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#6B6B6B]">Last Name *</label>
                  <input
                    type="text"
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#6B6B6B]">Phone (optional)</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setActiveModal(null); setError(null); }}
                className="flex-1 py-3 bg-gray-100 text-[#1A1A1A] rounded-xl font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProfile}
                disabled={isLoading || !editFirstName || !editLastName}
                className="flex-1 py-3 bg-black text-white rounded-xl font-medium text-sm disabled:opacity-50"
              >
                {isLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </Modal>
        )}

        {/* Reset Checklist Modal */}
        {activeModal === 'resetChecklist' && (
          <Modal onClose={() => setActiveModal(null)}>
            <h3 className="text-lg font-medium text-[#1A1A1A] mb-2">Reset Checklist?</h3>
            <p className="text-sm text-[#6B6B6B] mb-6">
              This will reset your first week checklist progress and show it again on the home screen.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setActiveModal(null)}
                className="flex-1 py-3 bg-gray-100 text-[#1A1A1A] rounded-xl font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResetChecklist}
                className="flex-1 py-3 bg-black text-white rounded-xl font-medium text-sm"
              >
                Reset
              </button>
            </div>
          </Modal>
        )}

        {/* Language Modal */}
        {showLanguageModal && (
          <Modal onClose={() => setShowLanguageModal(false)}>
            <h3 className="text-lg font-medium text-[#1A1A1A] mb-2">{t('settings.language.title')}</h3>
            <p className="text-sm text-[#6B6B6B] mb-6">{t('settings.language.description')}</p>

            <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
              {locales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => {
                    setLocale(loc);
                    setShowLanguageModal(false);
                    showSuccess(t('settings.language.title') + ': ' + localeNames[loc]);
                  }}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 transition-all ${
                    locale === loc
                      ? 'border-black bg-black text-white'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <span className="text-xl">{localeFlags[loc]}</span>
                  <span className="text-sm font-medium">{localeNames[loc]}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowLanguageModal(false)}
              className="w-full py-3 mt-6 bg-gray-100 text-[#1A1A1A] rounded-xl font-medium text-sm"
            >
              {t('common.close')}
            </button>
          </Modal>
        )}

        {/* Delete Account Modal */}
        {activeModal === 'delete' && (
          <Modal onClose={() => { setActiveModal(null); setError(null); }}>
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#1A1A1A] mb-2">Delete Account?</h3>
              <p className="text-sm text-[#6B6B6B]">
                This will permanently delete all your data including saved preferences, chat history, and survey responses. <strong>This action cannot be undone.</strong>
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#6B6B6B]">Enter your password</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-[#6B6B6B]">Type DELETE to confirm</label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setActiveModal(null); setError(null); }}
                className="flex-1 py-3 bg-gray-100 text-[#1A1A1A] rounded-xl font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isLoading || deleteConfirmText !== 'DELETE' || !deletePassword}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium text-sm disabled:opacity-50"
              >
                {isLoading ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}

// Modal Component
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
