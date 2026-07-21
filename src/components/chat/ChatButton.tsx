'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AIOrb } from '@/components/ui/AIOrb';

interface ChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
  hasNewMessage?: boolean;
}

export function ChatButton({ isOpen, onClick, hasNewMessage = false }: ChatButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      className="fixed bottom-28 right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center"
      style={{
        background: 'rgba(255,255,255,0.75)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.8)',
        boxShadow: '0 8px 32px rgba(109,100,168,0.28)',
      }}
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
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2B2740"
            strokeWidth="2"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        ) : (
          <motion.div
            key="orb"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <AIOrb size={38} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* New message indicator */}
      {hasNewMessage && !isOpen && (
        <motion.div
          className="absolute top-0 right-0 w-3 h-3 rounded-full"
          style={{ background: '#6D64A8' }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        />
      )}
    </motion.button>
  );
}
