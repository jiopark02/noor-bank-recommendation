import { useState, useCallback, useEffect } from "react";
import {
  UserContext,
  getContextualPrompts,
  QUICK_PROMPTS,
} from "@/lib/noorAIPrompt";

const STORAGE_KEY = "noor_chat_history";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  model?: string;
}

interface UseChatOptions {
  userId?: string | null;
  userContext?: UserContext;
  loadHistory?: boolean;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  currentModel: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  quickPrompts: Array<{ label: string; prompt: string }>;
}

interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
}

export function useChat({
  userId,
  userContext = {},
  loadHistory = true,
}: UseChatOptions = {}): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);

  const loadLocalHistory = useCallback((): ChatMessage[] => {
    if (!userId || typeof window === "undefined") {
      return [];
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as Record<string, StoredChatMessage[]>;
      const history = parsed[userId] || [];

      return history.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp),
        model: msg.model,
      }));
    } catch {
      return [];
    }
  }, [userId]);

  const loadChatHistory = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/chat?userId=${userId}`);
      const data = await response.json();

      if (data.messages && Array.isArray(data.messages)) {
        const formattedMessages: ChatMessage[] = data.messages.map(
          (msg: any) => ({
            id: msg.id || generateId(),
            role: msg.role,
            content: msg.content || msg.message || "",
            timestamp: new Date(msg.created_at || msg.timestamp || Date.now()),
            model: typeof msg.model === "string" ? msg.model : undefined,
          })
        );

        if (formattedMessages.length > 0) {
          setMessages(formattedMessages);
          return;
        }
      }

      setMessages(loadLocalHistory());
    } catch (err) {
      console.error("Failed to load chat history:", err);
      setMessages(loadLocalHistory());
    }
  }, [loadLocalHistory, userId]);

  // Load chat history on mount
  useEffect(() => {
    if (loadHistory && userId) {
      loadChatHistory();
    }
  }, [userId, loadHistory, loadChatHistory]);

  // Persist chat history locally for better UX continuity.
  useEffect(() => {
    if (!userId || typeof window === "undefined") {
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw
        ? (JSON.parse(raw) as Record<string, StoredChatMessage[]>)
        : {};

      parsed[userId] = messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp.toISOString(),
        model: msg.model,
      }));

      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // Ignore persistence failures to avoid blocking chat UX.
    }
  }, [messages, userId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      setIsLoading(true);
      setError(null);

      // Add user message immediately
      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);

      try {
        // Prepare messages for API (only content and role)
        const apiMessages = [...messages, userMessage].map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            userContext,
            userId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to get response");
        }

        // Add assistant message
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: data.message,
          timestamp: new Date(),
          model: typeof data.model === "string" ? data.model : undefined,
        };

        setCurrentModel(typeof data.model === "string" ? data.model : null);
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");

        // Add error message as assistant response
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content:
            "Sorry, there was an error generating a response. Please try again in a moment.",
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, userContext, userId]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);

    if (!userId || typeof window === "undefined") {
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw
        ? (JSON.parse(raw) as Record<string, StoredChatMessage[]>)
        : {};
      parsed[userId] = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // Ignore storage errors when clearing messages.
    }
  }, [userId]);

  // Get contextual or default quick prompts
  const quickPrompts = userContext
    ? getContextualPrompts(userContext)
    : QUICK_PROMPTS.slice(0, 4);

  return {
    messages,
    isLoading,
    error,
    currentModel,
    sendMessage,
    clearMessages,
    quickPrompts,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
