'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  SchoolTheme,
  DEFAULT_THEME,
  getSchoolTheme,
  getUseSchoolTheme,
  setUseSchoolTheme,
  getSavedThemeId,
  setSavedThemeId,
  getThemeCSSVariables,
} from '@/lib/schoolThemes';

interface ThemeContextType {
  theme: SchoolTheme;
  useSchoolTheme: boolean;
  setTheme: (institutionId: string) => void;
  toggleSchoolTheme: (use: boolean) => void;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<SchoolTheme>(DEFAULT_THEME);
  const [useSchoolThemeState, setUseSchoolThemeState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load theme from localStorage on mount
  useEffect(() => {
    const loadTheme = () => {
      const useTheme = getUseSchoolTheme();
      const themeId = getSavedThemeId();

      setUseSchoolThemeState(useTheme);

      if (useTheme && themeId) {
        setThemeState(getSchoolTheme(themeId));
      } else {
        setThemeState(DEFAULT_THEME);
      }

      setIsLoading(false);
    };

    loadTheme();
  }, []);

  // Apply CSS variables when theme changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const activeTheme = useSchoolThemeState ? theme : DEFAULT_THEME;
    const cssVars = getThemeCSSVariables(activeTheme);

    Object.entries(cssVars).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, [theme, useSchoolThemeState]);

  const setTheme = (institutionId: string) => {
    const newTheme = getSchoolTheme(institutionId);
    setThemeState(newTheme);
    setSavedThemeId(institutionId);
  };

  const toggleSchoolTheme = (use: boolean) => {
    setUseSchoolThemeState(use);
    setUseSchoolTheme(use);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme: useSchoolThemeState ? theme : DEFAULT_THEME,
        useSchoolTheme: useSchoolThemeState,
        setTheme,
        toggleSchoolTheme,
        isLoading,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Hook for getting themed styles
export function useThemedStyles() {
  const { theme, useSchoolTheme } = useTheme();

  return {
    primaryBg: useSchoolTheme ? theme.primary_color : '#000000',
    primaryText: useSchoolTheme
      ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
      : '#FFFFFF',
    secondaryColor: useSchoolTheme ? theme.secondary_color : '#FFFFFF',
    accentColor: useSchoolTheme ? (theme.accent_color || theme.secondary_color) : '#6B6B6B',
  };
}
