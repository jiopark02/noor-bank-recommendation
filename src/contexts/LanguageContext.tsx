'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// English is the only locale the app ships.
import en from '../../messages/en.json';

const messages: Record<string, unknown> = en;

interface LanguageContextType {
  t: (key: string) => string;
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
  const [isMounted, setIsMounted] = useState(false);

  // The provider has always rendered nothing until mount (it used to wait for
  // the saved locale). Every page under it relies on that: none of them is
  // rendered during the static prerender, so none has to be safe to render
  // without `window`. Keep the gate until that is checked page by page.
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const t = useCallback((key: string): string => getNestedValue(messages, key), []);

  if (!isMounted) {
    return null;
  }

  return (
    <LanguageContext.Provider value={{ t }}>
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
