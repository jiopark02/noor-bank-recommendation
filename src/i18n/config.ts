export const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'it', 'es', 'fr', 'de', 'pt', 'hi', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  'en': 'English',
  'ko': '한국어',
  'ja': '日本語',
  'zh-CN': '中文 (简体)',
  'zh-TW': '中文 (繁體)',
  'it': 'Italiano',
  'es': 'Español',
  'fr': 'Français',
  'de': 'Deutsch',
  'pt': 'Português',
  'hi': 'हिन्दी',
  'ar': 'العربية',
};

export const localeFlags: Record<Locale, string> = {
  'en': '🇺🇸',
  'ko': '🇰🇷',
  'ja': '🇯🇵',
  'zh-CN': '🇨🇳',
  'zh-TW': '🇹🇼',
  'it': '🇮🇹',
  'es': '🇪🇸',
  'fr': '🇫🇷',
  'de': '🇩🇪',
  'pt': '🇧🇷',
  'hi': '🇮🇳',
  'ar': '🇸🇦',
};

export const defaultLocale: Locale = 'en';

// RTL languages
export const rtlLocales: Locale[] = ['ar'];

export const isRTL = (locale: Locale): boolean => rtlLocales.includes(locale);
