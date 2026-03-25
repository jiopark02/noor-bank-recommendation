"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { BottomNav } from "@/components/layout";
import { UserLevel, getUserFinanceLevel } from "@/lib/financeProTips";
import { useChat } from "@/hooks/useChat";
import { UserContext } from "@/lib/noorAIPrompt";
import { supabase } from "@/lib/supabase";

function buildUserContext(profile: Record<string, unknown>): UserContext {
  return {
    firstName: profile.firstName as string | undefined,
    lastName: profile.lastName as string | undefined,
    university: profile.university as string | undefined,
    institutionType: profile.institutionType as string | undefined,
    visaType: profile.visaType as string | undefined,
    hasSSN: profile.hasSSN as boolean | undefined,
    hasCreditHistory: profile.hasCreditHistory as boolean | undefined,
    monthlyIncome: profile.monthlyIncome as number | undefined,
    campusSide: profile.campusSide as string | undefined,
    isTransferStudent: profile.isTransferStudent as boolean | undefined,
    targetSchools: profile.targetSchools as string[] | undefined,
    visaExpiry: profile.visaExpiry as string | undefined,
    optStartDate: profile.optStartDate as string | undefined,
    monthlySpending: profile.monthlySpending as number | undefined,
    savingsGoal: profile.savingsGoal as number | undefined,
  };
}

export default function ChatPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [userLevel, setUserLevel] = useState<UserLevel>("beginner");
  const [userId, setUserId] = useState<string | null>(null);
  const [userContext, setUserContext] = useState<UserContext>({});
  const [isBooting, setIsBooting] = useState(true);

  const quickPromptHandledRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    quickPrompts,
  } = useChat({
    userId,
    userContext,
    loadHistory: true,
  });

  useEffect(() => {
    let isMounted = true;

    const hydrateFromSession = async () => {
      if (!supabase) {
        if (isMounted) {
          router.replace("/welcome");
        }
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        if (isMounted) {
          router.replace("/welcome");
        }
        return;
      }

      const resolvedUserId = session.user.id;
      if (!isMounted) return;
      setUserId(resolvedUserId);

      try {
        const [{ data: userRow }, { data: surveyRow }] = await Promise.all([
          supabase
            .from("users")
            .select("first_name,last_name")
            .eq("id", resolvedUserId)
            .maybeSingle(),
          supabase
            .from("survey_responses")
            .select(
              "university,institution_type,has_ssn,has_us_credit_history,monthly_income,campus_side,expected_monthly_spending"
            )
            .eq("user_id", resolvedUserId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        const profile = {
          firstName: userRow?.first_name,
          lastName: userRow?.last_name,
          university: surveyRow?.university,
          institutionType: surveyRow?.institution_type,
          hasSSN: surveyRow?.has_ssn,
          hasCreditHistory: surveyRow?.has_us_credit_history,
          monthlyIncome: surveyRow?.monthly_income,
          campusSide: surveyRow?.campus_side,
          monthlySpending: surveyRow?.expected_monthly_spending,
        } as Record<string, unknown>;

        setUserContext(buildUserContext(profile));

        const level = getUserFinanceLevel({
          studentLevel: profile.studentLevel as string | undefined,
          academicLevel: profile.academicLevel as string | undefined,
          year: profile.graduationYear
            ? new Date().getFullYear() -
              (parseInt(profile.graduationYear as string, 10) - 4)
            : undefined,
          visaStatus: profile.visaStatus as string | undefined,
        });
        setUserLevel(level);
      } catch {
        // Keep defaults if profile query fails.
      } finally {
        if (isMounted) {
          setIsBooting(false);
        }
      }
    };

    hydrateFromSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!quickPromptHandledRef.current && userId) {
      const quickPrompt = localStorage.getItem("noor_quick_prompt");
      if (quickPrompt) {
        quickPromptHandledRef.current = true;
        localStorage.removeItem("noor_quick_prompt");
        void sendMessage(quickPrompt);
      }
    }
  }, [sendMessage, userId]);

  const handleSend = async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if (!text || isLoading) return;

    setInput("");
    await sendMessage(text);
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (isLoading) return;
    await handleSend(prompt);
  };

  if (isBooting) {
    return (
      <div className="min-h-screen bg-[#FAF9F7] flex items-center justify-center">
        <motion.div
          className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F7] flex flex-col">
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1">
            <svg
              className="w-5 h-5 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-medium text-black">Noor AI</h1>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  userLevel === "beginner"
                    ? "bg-green-100 text-green-700"
                    : userLevel === "intermediate"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-purple-100 text-purple-700"
                }`}
              >
                {userLevel === "beginner"
                  ? "Foundations"
                  : userLevel === "intermediate"
                  ? "Building"
                  : "Advanced"}
              </span>
            </div>
            <p className="text-xs text-gray-500">Personalized to your level</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear chat
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {messages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-black mb-2">
              Ask me anything
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              I can help with banking, visa questions, taxes, and more.
            </p>

            <div className="flex flex-wrap justify-center gap-2">
              {quickPrompts.map((prompt, index) => (
                <button
                  key={`${prompt.label}-${index}`}
                  onClick={() => handleQuickPrompt(prompt.prompt)}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm text-gray-700 hover:border-gray-400 transition-colors"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      message.role === "user"
                        ? "bg-black text-white"
                        : "bg-white border border-gray-200"
                    }`}
                  >
                    <p
                      className={`text-sm whitespace-pre-wrap ${
                        message.role === "user" ? "text-white" : "text-gray-800"
                      }`}
                    >
                      {message.content}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask about banking, visa, taxes..."
            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300 transition-all"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading}
            className="p-3 bg-black text-white rounded-xl disabled:opacity-50 transition-all hover:bg-gray-800"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
