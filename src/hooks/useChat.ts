import { useState, useCallback, useEffect } from 'react';
import { UserContext, getContextualPrompts, QUICK_PROMPTS } from '@/lib/noorAIPrompt';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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

  // Load chat history on mount
  useEffect(() => {
    if (loadHistory && userId) {
      loadChatHistory();
    }
  }, [userId, loadHistory]);

  const loadChatHistory = async () => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/chat?userId=${userId}`);
      const data = await response.json();

      if (data.messages && Array.isArray(data.messages)) {
        const formattedMessages: ChatMessage[] = data.messages.map((msg: any) => ({
          id: msg.id || generateId(),
          role: msg.role,
          content: msg.message,
          timestamp: new Date(msg.created_at),
        }));
        setMessages(formattedMessages);
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  };

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    setIsLoading(true);
    setError(null);

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    try {
      // Prepare messages for API (only content and role)
      const apiMessages = [...messages, userMessage].map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          userContext,
          userId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.message,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');

      // Add error message as assistant response
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '죄송해요, 응답을 생성하는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요. 🙏',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, userContext, userId]);

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
    sendMessage,
    clearMessages,
    quickPrompts,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
