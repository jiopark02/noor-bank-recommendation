import { useState, useCallback, useEffect, useRef } from "react";
import {
  UserContext,
  getContextualPrompts,
  QUICK_PROMPTS,
} from "@/lib/noorAIPrompt";
import {
  buildBearerOnlyHeaders,
  buildJsonAuthorizedHeaders,
} from "@/lib/supabaseAuthHeaders";
import { getSupabaseBearerHeaders } from "@/lib/supabase-browser";
import { asPlainObject, readErrorMessage } from "@/lib/requestJson";

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

export function useChat({
  userId,
  userContext = {},
  loadHistory = true,
}: UseChatOptions = {}): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const isSendingRef = useRef(false);

  const loadChatHistory = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/chat`, {
        headers: buildBearerOnlyHeaders(await getSupabaseBearerHeaders()),
      });
      const data = asPlainObject(await response.json());

      if (Array.isArray(data.messages)) {
        const formattedMessages: ChatMessage[] = data.messages.map(
          (msg: unknown) => {
            const m = asPlainObject(msg);
            const role =
              m.role === "assistant" || m.role === "user" ? m.role : "user";
            const content =
              typeof m.content === "string"
                ? m.content
                : typeof m.message === "string"
                  ? m.message
                  : "";
            const ts =
              typeof m.created_at === "string"
                ? m.created_at
                : typeof m.timestamp === "string" ||
                    typeof m.timestamp === "number"
                  ? m.timestamp
                  : Date.now();
            return {
              id: typeof m.id === "string" ? m.id : generateId(),
              role,
              content,
              timestamp: new Date(ts),
              model: typeof m.model === "string" ? m.model : undefined,
            };
          }
        );

        setMessages(formattedMessages);
        return;
      }

      setMessages([]);
    } catch (err) {
      console.error("Failed to load chat history:", err);
      setMessages([]);
    }
  }, [userId]);

  // Load chat history on mount
  useEffect(() => {
    if (loadHistory && userId) {
      loadChatHistory();
    }
  }, [userId, loadHistory, loadChatHistory]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isSendingRef.current) return;

      isSendingRef.current = true;

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
          headers: buildJsonAuthorizedHeaders(
            await getSupabaseBearerHeaders()
          ),
          body: JSON.stringify({
            messages: apiMessages,
            userContext,
          }),
        });

        const data = asPlainObject(await response.json());

        if (!response.ok) {
          throw new Error(readErrorMessage(data) || "Failed to get response");
        }

        const assistantText =
          typeof data.message === "string"
            ? data.message
            : "Sorry, I could not generate a response.";

        // Add assistant message
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: assistantText,
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
        isSendingRef.current = false;
      }
    },
    [messages, userContext]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

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
