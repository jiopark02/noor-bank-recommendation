"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AIOrb } from "@/components/ui/AIOrb";
import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "./ChatMessage";
import { UserContext } from "@/lib/noorAIPrompt";

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string | null;
  userContext?: UserContext;
}

export function ChatModal({
  isOpen,
  onClose,
  userId,
  userContext,
}: ChatModalProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, isLoading, error, sendMessage, quickPrompts } = useChat({
    userId,
    userContext,
    loadHistory: true,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    setInputValue("");
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
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="liquid-glass-strong fixed bottom-28 right-4 z-50 w-[calc(100%-2rem)] max-w-md h-[70vh] max-h-[600px] rounded-3xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between flex-shrink-0 border-b border-white/15">
            <div className="flex items-center gap-3">
              <AIOrb size={36} />
              <div>
                <h3 className="font-medium text-sm text-white">Noor AI</h3>
                <p className="text-xs text-white/60">
                  Your personal finance assistant
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
                stroke="#FFFFFF"
                strokeWidth="2"
              >
                <path
                  d="M18 6L6 18M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div className="mb-4">
                  <AIOrb size={64} halo />
                </div>
                <h4 className="heading-serif text-lg text-[#cdb9f2] mb-1">Hi! I'm Noor</h4>
                <p className="text-sm text-white/60 mb-2">
                  I'm here to help with banking, housing, visa questions, and
                  more.
                </p>
                <p className="text-xs text-white/40 mb-6">
                  No question is too small. Take your time.
                </p>

                {/* Quick prompts */}
                <div className="w-full space-y-2">
                  <p className="text-xs text-white/40 mb-2">Common questions</p>
                  {quickPrompts.map((qp, index) => (
                    <button
                      key={index}
                      onClick={() => handleQuickPrompt(qp.prompt)}
                      className="w-full text-left px-4 py-3 rounded-2xl bg-white/10 border border-white/15 hover:bg-white/15 transition-colors text-sm text-white/85"
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
                  <ChatMessage role="assistant" content="" isTyping={true} />
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Quick prompts (when there are messages) */}
          {messages.length > 0 && messages.length < 4 && (
            <div className="px-4 py-2 border-t border-white/15 flex gap-2 overflow-x-auto hide-scrollbar">
              {quickPrompts.slice(0, 3).map((qp, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  disabled={isLoading}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 hover:bg-white/15 transition-colors text-xs text-white/70 disabled:opacity-50"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-white/15 flex-shrink-0"
          >
            {error && (
              <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type your message..."
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-white/10 border border-white/15 rounded-full text-sm text-white placeholder-white/40 outline-none focus:border-white/40 disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="p-3 rounded-full transition-all disabled:opacity-30 shadow-glass"
                style={{ backgroundColor: "#FFFFFF" }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2B2740"
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
