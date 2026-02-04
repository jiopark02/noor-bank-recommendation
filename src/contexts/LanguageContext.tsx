'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Locale, locales, defaultLocale, isRTL } from '@/i18n/config';
import { supabase } from '@/lib/supabase';

// Import all messages statically
import en from '../../messages/en.json';
import ko from '../../messages/ko.json';
import ja from '../../messages/ja.json';
import zhCN from '../../messages/zh-CN.json';
import zhTW from '../../messages/zh-TW.json';
import it from '../../messages/it.json';
import es from '../../messages/es.json';
import fr from '../../messages/fr.json';
import de from '../../messages/de.json';
import pt from '../../messages/pt.json';
import hi from '../../messages/hi.json';
import ar from '../../messages/ar.json';

// Messages map
const allMessages: Record<Locale, Record<string, unknown>> = {
  en,
  ko,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  it,
  es,
  fr,
  de,
  pt,
  hi,
  ar,
};

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  isRTL: boolean;
  t: (key: string) => string;
  messages: Record<string, unknown>;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Get nested value from object using dot notation
function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return path; // Return the key if path not found
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : path;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [messages, setMessages] = useState<Record<string, unknown>>(allMessages[defaultLocale]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load locale from localStorage on mount
  useEffect(() => {
    const savedLocale = localStorage.getItem('noor_locale') as Locale | null;
    if (savedLocale && locales.includes(savedLocale)) {
      setLocaleState(savedLocale);
      setMessages(allMessages[savedLocale]);
    }
    setIsLoaded(true);
  }, []);

  // Update messages when locale changes
  useEffect(() => {
    setMessages(allMessages[locale]);
  }, [locale]);

  // Update document direction for RTL languages
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = isRTL(locale) ? 'rtl' : 'ltr';
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback(async (newLocale: Locale) => {
    setLocaleState(newLocale);
    setMessages(allMessages[newLocale]);
    localStorage.setItem('noor_locale', newLocale);

    // Also save to user profile if available
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      try {
        const parsed = JSON.parse(profile);
        parsed.language = newLocale;
        localStorage.setItem('noor_user_profile', JSON.stringify(parsed));

        // Save to Supabase if user is logged in
        const userId = localStorage.getItem('noor_user_id');
        if (userId && supabase) {
          supabase
            .from('users')
            .update({ language: newLocale })
            .eq('id', userId)
            .then(() => {
              // Silent update
            });
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  const t = useCallback((key: string): string => {
    return getNestedValue(messages, key);
  }, [messages]);

  // Don't render children until we've loaded the locale from localStorage
  if (!isLoaded) {
    return null;
  }

  return (
    <LanguageContext.Provider
      value={{
        locale,
        setLocale,
        isRTL: isRTL(locale),
        t,
        messages,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// Hook for simple translation
export function useTranslation() {
  const { t, locale, isRTL } = useLanguage();
  return { t, locale, isRTL };
}
