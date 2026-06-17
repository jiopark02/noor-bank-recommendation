"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { BottomNav } from "@/components/layout";
import { UserLevel, getUserFinanceLevel } from "@/lib/financeProTips";
import { useChat } from "@/hooks/useChat";
import { UserContext } from "@/lib/noorAIPrompt";
import { supabase, getSessionSafe } from "@/lib/supabase-browser";

const FONT = "'SF Pro Display', 'Helvetica Neue', -apple-system, Inter, sans-serif";

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

function formatContent(content: string): React.ReactNode {
  const lines = content.replace(/\\\$/g, "$").split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return <span key={i} className="block ml-3 my-0.5">• {line.slice(2)}</span>;
    }
    if (/^(\d+)\.\s/.test(line)) {
      return <span key={i} className="block ml-3 my-0.5">{line}</span>;
    }
    if (line.includes("**")) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      return (
        <span key={i} className="block">
          {parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}
        </span>
      );
    }
    return <span key={i} className={i > 0 ? "block" : undefined}>{line}</span>;
  });
}

const LEVEL_LABEL: Record<UserLevel, string> = {
  beginner: "Foundations",
  intermediate: "Building",
  advanced: "Advanced",
};

export default function ChatPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [userLevel, setUserLevel] = useState<UserLevel>("beginner");
  const [userId, setUserId] = useState<string | null>(null);
  const [userContext, setUserContext] = useState<UserContext>({});
  const [userName, setUserName] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isFocused, setIsFocused] = useState(false);

  // Read and clear the pending prompt synchronously on first render so it
  // can be displayed immediately — before auth/boot completes.
  const [initialPrompt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const qp = localStorage.getItem("noor_quick_prompt");
      if (qp) { localStorage.removeItem("noor_quick_prompt"); return qp; }
    } catch { /* ignore */ }
    return null;
  });

  const quickPromptHandledRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, isLoading, error, sendMessage, clearMessages, quickPrompts } = useChat({
    userId,
    userContext,
    loadHistory: true,
  });

  useEffect(() => {
    let isMounted = true;
    const hydrate = async () => {
      if (!supabase) { if (isMounted) router.replace("/landing"); return; }
      const session = await getSessionSafe();
      if (!session?.user) { if (isMounted) router.replace("/landing"); return; }
      const uid = session.user.id;
      if (!isMounted) return;
      setUserId(uid);
      try {
        const [{ data: userRow }, { data: surveyRow }] = await Promise.all([
          supabase.from("users").select("first_name,last_name").eq("id", uid).maybeSingle(),
          supabase.from("survey_responses")
            .select("university,institution_type,has_ssn,has_us_credit_history,monthly_income,campus_side,expected_monthly_spending")
            .eq("user_id", uid).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (!isMounted) return;
        if (userRow?.first_name) setUserName(userRow.first_name);
        const profile = {
          firstName: userRow?.first_name, lastName: userRow?.last_name,
          university: surveyRow?.university, institutionType: surveyRow?.institution_type,
          hasSSN: surveyRow?.has_ssn, hasCreditHistory: surveyRow?.has_us_credit_history,
          monthlyIncome: surveyRow?.monthly_income, campusSide: surveyRow?.campus_side,
          monthlySpending: surveyRow?.expected_monthly_spending,
        } as Record<string, unknown>;
        setUserContext(buildUserContext(profile));
        setUserLevel(getUserFinanceLevel({
          studentLevel: profile.studentLevel as string | undefined,
          academicLevel: profile.academicLevel as string | undefined,
          year: profile.graduationYear ? new Date().getFullYear() - (parseInt(profile.graduationYear as string, 10) - 4) : undefined,
          visaStatus: profile.visaStatus as string | undefined,
        }));
      } catch { /* keep defaults */ }
      finally { if (isMounted) setIsBooting(false); }
    };
    hydrate();
    return () => { isMounted = false; };
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!quickPromptHandledRef.current && userId) {
      const source =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("source")
          : null;

      if (source !== "quickprompt") {
        localStorage.removeItem("noor_quick_prompt");
        return;
      }

      const quickPrompt = localStorage.getItem("noor_quick_prompt")?.trim();
      if (quickPrompt) {
        quickPromptHandledRef.current = true;
        localStorage.removeItem("noor_quick_prompt");
        void sendMessage(quickPrompt);
      }
    }
  }, [sendMessage, userId, initialPrompt]);

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isLoading) return;
    setInput("");
    await sendMessage(msg);
  };

  // Only block the whole page on boot if there's no question to show yet.
  // If a quick prompt was tapped, render the page immediately so the user
  // sees their question right away — auth resolves in the background.
  if (isBooting && !initialPrompt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div
          className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-black"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  // While still booting but we have a pending prompt, show it optimistically
  // so the user sees their question and the typing indicator immediately.
  const displayMessages =
    isBooting && initialPrompt && messages.length === 0
      ? [{ id: "pending", role: "user" as const, content: initialPrompt, timestamp: new Date() }]
      : messages;
  const displayLoading = (isBooting && !!initialPrompt) || isLoading;

  return (
    <div className="min-h-screen flex flex-col bg-white" style={{ fontFamily: FONT }}>

      {/* ── HEADER ── */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3"
        style={{
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(0,0,0,0.07)",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-black" style={{ fontFamily: FONT }}>
                Noor AI
              </span>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                style={{ fontFamily: FONT }}
              >
                {LEVEL_LABEL[userLevel]}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5" style={{ fontFamily: FONT }}>
              {userName ? `Personalized for ${userName}` : "Personalized to your profile"}
            </p>
          </div>
        </div>

        <AnimatePresence>
          {displayMessages.length > 0 && (
            <motion.button
              onClick={clearMessages}
              className="text-[12px] text-gray-400 hover:text-black transition-colors px-2 py-1"
              style={{ fontFamily: FONT }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Clear
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── MESSAGES ── */}
      <div className="flex-1 overflow-y-auto pt-[64px] pb-[136px]">
        {displayMessages.length === 0 ? (
          /* ── EMPTY STATE ── */
          <motion.div
            className="max-w-md mx-auto px-5 pt-14 pb-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {/* Wordmark */}
            <div className="mb-8">
              <p
                className="text-[11px] font-medium tracking-widest text-gray-400 uppercase mb-3"
                style={{ fontFamily: FONT, letterSpacing: "0.18em" }}
              >
                NOOR
              </p>
              <h2
                className="text-[26px] font-semibold text-black leading-tight"
                style={{ fontFamily: FONT, letterSpacing: "-0.02em" }}
              >
                {userName ? `Hi ${userName}.` : "Ask me anything."}
              </h2>
              <p className="text-[14px] text-gray-400 mt-1.5 leading-relaxed" style={{ fontFamily: FONT }}>
                Banking, credit, visa, taxes — I know your profile.
              </p>
            </div>

            {/* Prompts as plain rows */}
            <div className="space-y-1">
              {quickPrompts.slice(0, 6).map((p, i) => (
                <motion.button
                  key={i}
                  onClick={() => void handleSend(p.prompt)}
                  className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left group transition-colors"
                  style={{
                    background: "rgba(0,0,0,0.03)",
                    border: "1px solid rgba(0,0,0,0)",
                  }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.055, duration: 0.3 }}
                  whileHover={{ background: "rgba(0,0,0,0.06)" }}
                  whileTap={{ scale: 0.99 }}
                >
                  <span className="text-[13.5px] text-black" style={{ fontFamily: FONT }}>
                    {p.label}
                  </span>
                  <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          /* ── CONVERSATION ── */
          <div className="max-w-lg mx-auto px-4 py-5 space-y-3">
            <AnimatePresence>
              {displayMessages.map((msg, i) => {
                const isUser = msg.role === "user";
                return (
                  <motion.div
                    key={msg.id}
                    className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.15), ease: "easeOut" }}
                  >
                    {!isUser && (
                      <div
                        className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center mb-0.5 bg-black"
                      >
                        <span className="text-[9px] font-semibold text-white" style={{ fontFamily: FONT, letterSpacing: "0.06em" }}>N</span>
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] px-4 py-3 text-[14px] leading-relaxed ${
                        isUser ? "rounded-2xl rounded-br-[5px]" : "rounded-2xl rounded-bl-[5px]"
                      }`}
                      style={{
                        fontFamily: FONT,
                        ...(isUser
                          ? { background: "#0A0A0A", color: "#FFFFFF" }
                          : { background: "#F5F5F5", color: "#0A0A0A" }),
                      }}
                    >
                      {formatContent(msg.content)}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            <AnimatePresence>
              {displayLoading && (
                <motion.div
                  className="flex items-end gap-2 justify-start"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center mb-0.5 bg-black">
                    <span className="text-[9px] font-semibold text-white" style={{ fontFamily: FONT, letterSpacing: "0.06em" }}>N</span>
                  </div>
                  <div className="px-4 py-3.5 rounded-2xl rounded-bl-[5px] bg-[#F5F5F5]">
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-gray-400"
                          animate={{ y: [0, -4, 0] }}
                          transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── INPUT ── */}
      <div
        className="fixed left-0 right-0 z-20 px-4 pb-3"
        style={{ bottom: "64px" }}
      >
        {/* Fade behind input */}
        <div
          className="absolute inset-x-0 -top-8 bottom-0 pointer-events-none"
          style={{ background: "linear-gradient(to top, white 60%, rgba(255,255,255,0))" }}
        />

        {/* Inline quick prompts when conversation active */}
        <AnimatePresence>
          {displayMessages.length > 0 && !displayLoading && (
            <motion.div
              className="relative flex gap-2 overflow-x-auto pb-2.5"
              style={{ scrollbarWidth: "none" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {quickPrompts.slice(0, 4).map((p, i) => (
                <button
                  key={i}
                  onClick={() => void handleSend(p.prompt)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] whitespace-nowrap transition-colors"
                  style={{
                    background: "white",
                    border: "1px solid rgba(0,0,0,0.12)",
                    color: "rgba(0,0,0,0.55)",
                    fontFamily: FONT,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              className="mb-2 px-3 py-2 rounded-xl text-[12px] text-red-600 bg-red-50 border border-red-100"
              style={{ fontFamily: FONT }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input row */}
        <div
          className="relative flex items-center gap-2"
          style={{
            background: "#FFFFFF",
            border: `1px solid ${isFocused ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.1)"}`,
            borderRadius: "16px",
            padding: "7px 7px 7px 16px",
            boxShadow: isFocused ? "0 2px 16px rgba(0,0,0,0.09)" : "0 2px 10px rgba(0,0,0,0.06)",
            transition: "border-color 0.18s, box-shadow 0.18s",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
            }}
            placeholder="Ask about banking, visa, taxes…"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-gray-300"
            style={{ fontFamily: FONT, color: "#0A0A0A" }}
          />

          <motion.button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: input.trim() && !isLoading ? "#0A0A0A" : "rgba(0,0,0,0.07)",
              transition: "background 0.18s",
            }}
            whileTap={input.trim() && !isLoading ? { scale: 0.9 } : {}}
          >
            {isLoading ? (
              <motion.div
                className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              />
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 7H12M12 7L8 3M12 7L8 11"
                  stroke={input.trim() ? "white" : "rgba(0,0,0,0.25)"}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </motion.button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
