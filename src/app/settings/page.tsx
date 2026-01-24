'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import { useTheme } from '@/contexts/ThemeContext';
import { getSchoolTheme, hasCustomTheme, SCHOOL_THEMES, DEFAULT_THEME } from '@/lib/schoolThemes';

interface UserProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  institutionId?: string;
  university?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const { theme, useSchoolTheme, toggleSchoolTheme, setTheme } = useTheme();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showThemePreview, setShowThemePreview] = useState(false);

  useEffect(() => {
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      setUserProfile(JSON.parse(profile));
    }
  }, []);

  const schoolTheme = userProfile?.institutionId
    ? getSchoolTheme(userProfile.institutionId)
    : null;

  const hasTheme = userProfile?.institutionId
    ? hasCustomTheme(userProfile.institutionId)
    : false;

  const handleLogout = () => {
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

      <div className="px-4 py-6 space-y-4">
        {/* Profile Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Profile</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
              <span className="text-sm text-[#6B6B6B]">Name</span>
              <span className="text-sm text-[#1A1A1A]">
                {userProfile?.firstName} {userProfile?.lastName}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
              <span className="text-sm text-[#6B6B6B]">Email</span>
              <span className="text-sm text-[#1A1A1A]">{userProfile?.email}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[#6B6B6B]">School</span>
              <span className="text-sm text-[#1A1A1A]">{userProfile?.university || 'Not set'}</span>
            </div>
          </div>
        </motion.div>

        {/* School Theme Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[#1A1A1A]">School Theme</h3>
            {hasTheme && (
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
            )}
          </div>

          {hasTheme && schoolTheme ? (
            <div className="space-y-4">
              {/* Theme Preview */}
              <div
                className="p-4 rounded-xl flex items-center gap-4"
                style={{
                  backgroundColor: useSchoolTheme ? schoolTheme.primary_color : '#F5F4F2',
                }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-medium"
                  style={{
                    backgroundColor: schoolTheme.secondary_color,
                    color: schoolTheme.primary_color,
                  }}
                >
                  {schoolTheme.short_name.charAt(0)}
                </div>
                <div>
                  <p
                    className="font-medium"
                    style={{
                      color: useSchoolTheme
                        ? (schoolTheme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
                        : '#1A1A1A',
                    }}
                  >
                    {schoolTheme.name}
                  </p>
                  <p
                    className="text-xs"
                    style={{
                      color: useSchoolTheme
                        ? (schoolTheme.text_on_primary === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')
                        : '#6B6B6B',
                    }}
                  >
                    {schoolTheme.mascot || 'School colors'}
                  </p>
                </div>
              </div>

              {/* Color Preview */}
              <div className="flex gap-2">
                <div className="flex-1 p-3 rounded-lg text-center" style={{ backgroundColor: schoolTheme.primary_color }}>
                  <p className="text-xs" style={{ color: schoolTheme.text_on_primary === 'white' ? '#FFFFFF' : '#000000' }}>
                    Primary
                  </p>
                </div>
                <div className="flex-1 p-3 rounded-lg text-center border" style={{ backgroundColor: schoolTheme.secondary_color }}>
                  <p className="text-xs" style={{ color: schoolTheme.text_on_primary === 'white' ? '#000000' : '#FFFFFF' }}>
                    Secondary
                  </p>
                </div>
              </div>

              <p className="text-xs text-[#6B6B6B] text-center">
                {useSchoolTheme
                  ? 'School colors are applied to buttons, navigation, and accents.'
                  : 'Enable to customize Noor with your school colors.'}
              </p>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-[#6B6B6B]">
                No custom theme available for your school.
              </p>
              <p className="text-xs text-[#9B9B9B] mt-1">
                Using default Noor styling.
              </p>
            </div>
          )}
        </motion.div>

        {/* Appearance Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Appearance</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
              <span className="text-sm text-[#6B6B6B]">Display Mode</span>
              <span className="text-sm text-[#1A1A1A]">Light</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[#6B6B6B]">Language</span>
              <span className="text-sm text-[#1A1A1A]">English</span>
            </div>
          </div>
        </motion.div>

        {/* Data & Privacy Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
        >
          <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Data & Privacy</h3>
          <div className="space-y-3">
            <button className="w-full flex justify-between items-center py-2 border-b border-[#E8E6E3] text-left">
              <span className="text-sm text-[#6B6B6B]">Export Data</span>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
            <button className="w-full flex justify-between items-center py-2 text-left">
              <span className="text-sm text-[#6B6B6B]">Clear Cache</span>
              <span className="text-sm text-[#1A1A1A]">→</span>
            </button>
          </div>
        </motion.div>

        {/* Logout Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
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

      <BottomNav />
    </div>
  );
}
