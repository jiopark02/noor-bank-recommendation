'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { locales, localeNames, localeFlags, Locale } from '@/i18n/config';

interface LanguageSelectorProps {
  onContinue: () => void;
}

export function LanguageSelector({ onContinue }: LanguageSelectorProps) {
  const { locale, setLocale, t } = useLanguage();

  const handleLanguageSelect = (selectedLocale: Locale) => {
    setLocale(selectedLocale);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="pt-8 pb-4 text-center">
        <span className="text-xs tracking-[0.3em] font-medium text-gray-400">NOOR</span>
      </header>

      <div className="flex-1 max-w-md mx-auto px-6 pb-32 w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-semibold tracking-tight mb-2">
            {t('survey.languageSelect.title')}
          </h1>
          <p className="text-gray-500">
            {t('survey.languageSelect.subtitle')}
          </p>
        </motion.div>

        {/* Language Grid */}
        <div className="grid grid-cols-2 gap-3">
          {locales.map((loc, index) => (
            <motion.button
              key={loc}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              onClick={() => handleLanguageSelect(loc)}
              className={`flex items-center gap-3 px-4 py-4 rounded-xl border-2 transition-all duration-300 ${
                locale === loc
                  ? 'border-black bg-black text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              <span className="text-2xl">{localeFlags[loc]}</span>
              <span className="font-medium text-sm">{localeNames[loc]}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100">
        <div className="max-w-md mx-auto px-6 py-5">
          <button
            onClick={onContinue}
            className="w-full py-3.5 bg-black text-white rounded-xl font-medium transition-all duration-300 hover:bg-gray-800"
          >
            {t('survey.languageSelect.continue') || t('common.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
