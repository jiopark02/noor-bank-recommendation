'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

// Search result types
interface SearchResult {
  id: string;
  type: 'bank' | 'apartment' | 'scholarship' | 'job' | 'forum' | 'page';
  title: string;
  subtitle?: string;
  href: string;
  icon: string;
}

// Mock search data - in real app this would come from API/DB
const SEARCHABLE_ITEMS: SearchResult[] = [
  // Banks
  { id: 'chase', type: 'bank', title: 'Chase Bank', subtitle: 'No SSN required · Student account', href: '/banking', icon: '🏦' },
  { id: 'bofa', type: 'bank', title: 'Bank of America', subtitle: 'Nationwide · Zelle support', href: '/banking', icon: '🏦' },
  { id: 'wells', type: 'bank', title: 'Wells Fargo', subtitle: 'Many ATMs · Student checking', href: '/banking', icon: '🏦' },
  { id: 'discover', type: 'bank', title: 'Discover Bank', subtitle: 'No fees · High APY', href: '/banking', icon: '🏦' },
  { id: 'capital-one', type: 'bank', title: 'Capital One', subtitle: 'No foreign fees · 360 Checking', href: '/banking', icon: '🏦' },

  // Scholarships
  { id: 'fulbright', type: 'scholarship', title: 'Fulbright Scholarship', subtitle: '$30,000 · All majors', href: '/funding', icon: '🎓' },
  { id: 'rotary', type: 'scholarship', title: 'Rotary International', subtitle: '$15,000 · Peace studies', href: '/funding', icon: '🎓' },
  { id: 'aauw', type: 'scholarship', title: 'AAUW Fellowship', subtitle: '$20,000 · Women in STEM', href: '/funding', icon: '🎓' },

  // Jobs
  { id: 'ta', type: 'job', title: 'Teaching Assistant', subtitle: '$15-20/hr · On campus', href: '/jobs', icon: '💼' },
  { id: 'ra', type: 'job', title: 'Research Assistant', subtitle: '$18-25/hr · Lab work', href: '/jobs', icon: '💼' },
  { id: 'library', type: 'job', title: 'Library Assistant', subtitle: '$12-15/hr · Flexible hours', href: '/jobs', icon: '💼' },
  { id: 'tutor', type: 'job', title: 'Peer Tutor', subtitle: '$15-22/hr · Academic help', href: '/jobs', icon: '💼' },

  // Pages
  { id: 'page-banking', type: 'page', title: 'Banking', subtitle: 'Bank accounts & credit cards', href: '/banking', icon: '📄' },
  { id: 'page-housing', type: 'page', title: 'Housing', subtitle: 'Find apartments near campus', href: '/housing', icon: '📄' },
  { id: 'page-visa', type: 'page', title: 'Visa Tracker', subtitle: 'F-1 status & OPT timeline', href: '/visa', icon: '📄' },
  { id: 'page-funding', type: 'page', title: 'Funding', subtitle: 'Scholarships & grants', href: '/funding', icon: '📄' },
  { id: 'page-jobs', type: 'page', title: 'Jobs', subtitle: 'Campus & CPT jobs', href: '/jobs', icon: '📄' },
  { id: 'page-forum', type: 'page', title: 'Forum', subtitle: 'Community discussions', href: '/forum', icon: '📄' },
  { id: 'page-deals', type: 'page', title: 'Deals', subtitle: 'Student discounts', href: '/deals', icon: '📄' },
  { id: 'page-settings', type: 'page', title: 'Settings', subtitle: 'Profile & preferences', href: '/settings', icon: '⚙️' },

  // Common searches
  { id: 'ssn', type: 'page', title: 'Open account without SSN', subtitle: 'Guide', href: '/banking', icon: '❓' },
  { id: 'opt', type: 'page', title: 'OPT Application', subtitle: 'Timeline & requirements', href: '/visa', icon: '❓' },
  { id: 'credit', type: 'page', title: 'Build Credit History', subtitle: 'First credit card guide', href: '/banking', icon: '❓' },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const router = useRouter();
  const { theme, useSchoolTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeColor = useSchoolTheme ? theme.primary_color : '#000000';

  // Filter results based on query
  const results = useMemo(() => {
    if (!query.trim()) {
      // Show recent/popular searches when empty
      return SEARCHABLE_ITEMS.filter(item => item.type === 'page').slice(0, 6);
    }

    const searchQuery = query.toLowerCase();
    return SEARCHABLE_ITEMS.filter(item =>
      item.title.toLowerCase().includes(searchQuery) ||
      item.subtitle?.toLowerCase().includes(searchQuery)
    ).slice(0, 8);
  }, [query]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, onClose]);

  const handleSelect = (result: SearchResult) => {
    router.push(result.href);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="liquid-glass fixed inset-x-4 top-20 z-50 rounded-3xl overflow-hidden max-w-lg mx-auto"
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 p-4 border-b border-white/15">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Search banks, scholarships, jobs..."
                className="flex-1 text-base text-white outline-none placeholder:text-white/40 bg-transparent"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="p-1 text-white/50 hover:text-white"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {results.length === 0 ? (
                <div className="p-8 text-center text-white/60">
                  <p>No results found for "{query}"</p>
                  <p className="text-sm mt-1">Try searching for banks, scholarships, or jobs</p>
                </div>
              ) : (
                <div className="p-2">
                  {!query && (
                    <p className="px-3 py-2 text-xs text-white/40 font-medium">Quick links</p>
                  )}
                  {results.map((result, index) => (
                    <button
                      key={result.id}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                        index === selectedIndex ? 'bg-white/15' : 'hover:bg-white/8'
                      }`}
                    >
                      <span className="text-xl">{result.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{result.title}</p>
                        {result.subtitle && (
                          <p className="text-sm text-white/60 truncate">{result.subtitle}</p>
                        )}
                      </div>
                      <span className="text-xs text-white/40 capitalize">{result.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-white/15 flex items-center justify-between text-xs text-white/40">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">↑↓</span>
                <span>Navigate</span>
                <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] ml-2">↵</span>
                <span>Select</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">esc</span>
                <span>Close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
