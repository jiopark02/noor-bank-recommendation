'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Locale, locales, defaultLocale, isRTL } from '@/i18n/config';

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  isRTL: boolean;
  t: (key: string) => string;
  messages: Record<string, unknown>;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Cache for loaded messages
const messagesCache: Record<string, Record<string, unknown>> = {};

// Dynamically import messages
async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  if (messagesCache[locale]) {
    return messagesCache[locale];
  }

  try {
    const messages = await import(`../../messages/${locale}.json`);
    messagesCache[locale] = messages.default || messages;
    return messagesCache[locale];
  } catch (error) {
    console.error(`Failed to load messages for locale: ${locale}`, error);
    // Fallback to English
    if (locale !== 'en') {
      return loadMessages('en');
    }
    return {};
  }
}

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
  const [messages, setMessages] = useState<Record<string, unknown>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  // Load locale from localStorage on mount
  useEffect(() => {
    const savedLocale = localStorage.getItem('noor_locale') as Locale | null;
    if (savedLocale && locales.includes(savedLocale)) {
      setLocaleState(savedLocale);
    }
    setIsLoaded(true);
  }, []);

  // Load messages when locale changes
  useEffect(() => {
    loadMessages(locale).then(setMessages);
  }, [locale]);

  // Update document direction for RTL languages
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = isRTL(locale) ? 'rtl' : 'ltr';
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('noor_locale', newLocale);

    // Also save to user profile if available
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      try {
        const parsed = JSON.parse(profile);
        parsed.language = newLocale;
        localStorage.setItem('noor_user_profile', JSON.stringify(parsed));
      } catch (e) {
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
