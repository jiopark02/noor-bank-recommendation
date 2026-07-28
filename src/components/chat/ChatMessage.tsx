"use client";

import React from "react";
import { motion } from "framer-motion";
import { AIOrb } from "@/components/ui/AIOrb";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  isTyping?: boolean;
}

export function ChatMessage({
  role,
  content,
  timestamp,
  isTyping = false,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div className="mr-2 flex-shrink-0">
          <AIOrb size={28} />
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser ? "rounded-br-md" : "rounded-bl-md"
        }`}
        style={
          isUser
            ? {
                backgroundColor: "#000000",
                color: "#FFFFFF",
                boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
              }
            : {
                background: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.75)",
                color: "#000000",
              }
        }
      >
        {isTyping ? (
          <TypingIndicator />
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">
              {formatContent(content, !isUser)}
            </p>
            {timestamp && (
              <p
                className={`text-[10px] mt-1 ${
                  isUser ? "opacity-70" : "text-gray-400"
                }`}
              >
                {formatTime(timestamp)}
              </p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full"
          animate={{ y: [0, -4, 0] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

function formatContent(
  content: string,
  normalizeCurrencyEscapes = false
): React.ReactNode {
  // Simple markdown-like formatting
  const normalizedContent = normalizeCurrencyEscapes
    ? content.replace(/\\\$/g, "$")
    : content;
  const lines = normalizedContent.split("\n");

  return lines.map((line, i) => {
    // Handle bullet points
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <span key={i} className="block ml-2">
          • {line.slice(2)}
        </span>
      );
    }

    // Handle numbered lists
    const numberedMatch = line.match(/^(\d+)\.\s/);
    if (numberedMatch) {
      return (
        <span key={i} className="block ml-2">
          {line}
        </span>
      );
    }

    // Handle bold text with **
    if (line.includes("**")) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      return (
        <span key={i} className="block">
          {parts.map((part, j) =>
            j % 2 === 1 ? <strong key={j}>{part}</strong> : part
          )}
        </span>
      );
    }

    // Regular line
    return (
      <span key={i} className={i > 0 ? "block" : undefined}>
        {line}
      </span>
    );
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
