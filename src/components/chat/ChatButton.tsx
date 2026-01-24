'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

interface ChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
  hasNewMessage?: boolean;
}

export function ChatButton({ isOpen, onClick, hasNewMessage = false }: ChatButtonProps) {
  const { theme, useSchoolTheme } = useTheme();

  const buttonColor = useSchoolTheme ? theme.primary_color : '#000000';
  const iconColor = useSchoolTheme
    ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
    : '#FFFFFF';

  return (
    <motion.button
      onClick={onClick}
      className="fixed bottom-28 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
      style={{ backgroundColor: buttonColor }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <AnimatePresence mode="wait">
        {isOpen ? (
          <motion.svg
            key="close"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke={iconColor}
            strokeWidth="2"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        ) : (
          <motion.svg
            key="chat"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke={iconColor}
            strokeWidth="2"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <path
              d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        )}
      </AnimatePresence>

      {/* New message indicator */}
      {hasNewMessage && !isOpen && (
        <motion.div
          className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        />
      )}
    </motion.button>
  );
}
