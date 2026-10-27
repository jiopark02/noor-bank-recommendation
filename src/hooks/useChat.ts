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
import {
  CHAT_MAX_LAST_USER_MESSAGE_CHARS,
  buildChatRequestMessages,
} from "@/lib/chatInputLimits";
import { detectCrisisSignal } from "@/lib/crisisSignals";
import { CRISIS_NOTICES } from "@/lib/crisisNotice";

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

      // Role and content only, fitted to the same window the route applies
      // (chatInputLimits.ts), so the server never has to refuse our history.
      // Null means the new message itself is over the length limit: it is not
      // sent, and its bubble stays visible because the caller has already
      // cleared the input. The window skips it on later turns.
      const apiMessages = buildChatRequestMessages(messages, userMessage);
      if (!apiMessages) {
        // Nothing reaches the server, so the crisis notice the route would
        // have attached is shown from here: always the standard one, and not
        // counted.
        const localCrisis = detectCrisisSignal(userMessage.content);
        if (localCrisis) {
          const noticeMessage: ChatMessage = {
            id: generateId(),
            role: "assistant",
            content: CRISIS_NOTICES[localCrisis].standard,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, noticeMessage]);
        }
        setError(
          `Your message is too long. Please keep it to at most ${CHAT_MAX_LAST_USER_MESSAGE_CHARS} characters.`
        );
        setIsLoading(false);
        isSendingRef.current = false;
        return;
      }

      // Set when the route refused the request under the chat usage limit.
      let usageLimitMessage: string | null = null;
      // Set when the route attached a crisis notice to an error response.
      let crisisNoticeText: string | null = null;
      try {
        // The body carries messages only. The route builds the user context
        // from the database and never read a client-sent one.
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: buildJsonAuthorizedHeaders(
            await getSupabaseBearerHeaders()
          ),
          body: JSON.stringify({
            messages: apiMessages,
          }),
        });

        const data = asPlainObject(await response.json());

        if (!response.ok) {
          if (typeof data.crisisNotice === "string" && data.crisisNotice) {
            crisisNoticeText = data.crisisNotice;
          }
          const serverMessage = readErrorMessage(data);
          // The server's text names the window that was hit; the generic
          // "try again in a moment" would be wrong for the day and 30-day
          // limits.
          if (data.code === "USAGE_LIMIT_REACHED" && serverMessage) {
            usageLimitMessage = serverMessage;
          }
          throw new Error(serverMessage || "Failed to get response");
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
            usageLimitMessage ??
            "Sorry, there was an error generating a response. Please try again in a moment.",
          timestamp: new Date(),
        };

        // No notice from the server: the response was not JSON, no response
        // arrived, or the route refused before parsing. Shown from here as on
        // the over-long refusal: always the standard one, and not counted.
        const fallbackCrisis = crisisNoticeText
          ? null
          : detectCrisisSignal(userMessage.content);
        const noticeText =
          crisisNoticeText ??
          (fallbackCrisis ? CRISIS_NOTICES[fallbackCrisis].standard : null);

        // The crisis notice comes first, as it does on a successful reply.
        const noticeMessages: ChatMessage[] = noticeText
          ? [
              {
                id: generateId(),
                role: "assistant",
                content: noticeText,
                timestamp: new Date(),
              },
            ]
          : [];

        setMessages((prev) => [...prev, ...noticeMessages, errorMessage]);
      } finally {
        setIsLoading(false);
        isSendingRef.current = false;
      }
    },
    [messages]
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
