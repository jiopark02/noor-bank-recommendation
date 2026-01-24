'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';
import { useChat, ChatMessage as ChatMessageType } from '@/hooks/useChat';
import { ChatMessage } from './ChatMessage';
import { UserContext } from '@/lib/noorAIPrompt';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string | null;
  userContext?: UserContext;
}

export function ChatModal({ isOpen, onClose, userId, userContext }: ChatModalProps) {
  const { theme, useSchoolTheme } = useTheme();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    quickPrompts,
  } = useChat({
    userId,
    userContext,
    loadHistory: true,
  });

  const headerColor = useSchoolTheme ? theme.primary_color : '#000000';
  const headerTextColor = useSchoolTheme
    ? (theme.text_on_primary === 'white' ? '#FFFFFF' : '#000000')
    : '#FFFFFF';

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue;
    setInputValue('');
    await sendMessage(message);
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (isLoading) return;
    await sendMessage(prompt);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed bottom-28 right-4 z-50 w-[calc(100%-2rem)] max-w-md h-[70vh] max-h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ border: '1px solid #E5E5E5' }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between flex-shrink-0"
            style={{ backgroundColor: headerColor }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: useSchoolTheme ? theme.secondary_color : '#FFFFFF',
                }}
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: useSchoolTheme ? theme.primary_color : '#000000' }}
                >
                  N
                </span>
              </div>
              <div>
                <h3 className="font-medium text-sm" style={{ color: headerTextColor }}>
                  Noor AI
                </h3>
                <p
                  className="text-xs"
                  style={{ color: headerTextColor, opacity: 0.7 }}
                >
                  유학생 금융 어시스턴트
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full transition-opacity hover:opacity-70"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke={headerTextColor}
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-white">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: useSchoolTheme ? `${theme.primary_color}15` : '#F5F5F5',
                  }}
                >
                  <span
                    className="text-2xl font-semibold"
                    style={{ color: useSchoolTheme ? theme.primary_color : '#000000' }}
                  >
                    N
                  </span>
                </div>
                <h4 className="font-medium text-gray-900 mb-1">
                  안녕하세요! Noor AI예요
                </h4>
                <p className="text-sm text-gray-500 mb-6">
                  미국 유학 생활에 대한 금융 질문이 있으시면 언제든 물어보세요.
                </p>

                {/* Quick prompts */}
                <div className="w-full space-y-2">
                  <p className="text-xs text-gray-400 mb-2">자주 묻는 질문</p>
                  {quickPrompts.map((qp, index) => (
                    <button
                      key={index}
                      onClick={() => handleQuickPrompt(qp.prompt)}
                      className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-sm text-gray-700"
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    timestamp={msg.timestamp}
                  />
                ))}
                {isLoading && (
                  <ChatMessage
                    role="assistant"
                    content=""
                    isTyping={true}
                  />
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Quick prompts (when there are messages) */}
          {messages.length > 0 && messages.length < 4 && (
            <div className="px-4 py-2 border-t border-gray-100 flex gap-2 overflow-x-auto hide-scrollbar">
              {quickPrompts.slice(0, 3).map((qp, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  disabled={isLoading}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-xs text-gray-600 disabled:opacity-50"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-gray-100 flex-shrink-0"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="메시지를 입력하세요..."
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="p-3 rounded-xl transition-all disabled:opacity-30"
                style={{
                  backgroundColor: useSchoolTheme ? theme.primary_color : '#000000',
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={headerTextColor}
                  strokeWidth="2"
                >
                  <path
                    d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
