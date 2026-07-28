"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { BottomNav } from "@/components/layout";
import { AIOrb } from "@/components/ui/AIOrb";
import { UserLevel, getUserFinanceLevel } from "@/lib/financeProTips";
import { useChat } from "@/hooks/useChat";
import { UserContext } from "@/lib/noorAIPrompt";
import { supabase, getSessionSafe } from "@/lib/supabase-browser";

const FONT = "Inter, 'SF Pro Display', 'Helvetica Neue', -apple-system, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

// Guards the one-shot auto-reload below. sessionStorage survives a reload
// (same tab) so the second hydrate pass after a reload sees the flag and
// stops, preventing an infinite reload loop. Cleared on a valid session so a
// future stale event can self-heal again.
const AUTH_RELOAD_FLAG = "noor_auth_stale_reload";

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
      if (!supabase) { if (isMounted) router.replace("/login"); return; }
      const session = await getSessionSafe();
      if (!session?.user) {
        // getSessionSafe returned null: either a genuinely absent session (logged
        // out / expired) or a stale Supabase client whose getSession() timed out
        // (known SDK bug — a backgrounded tab can corrupt the client so getSession
        // hangs even though the cookie session is still valid; the only reliable
        // recovery is recreating the client via a full reload). We can't distinguish
        // the two from null alone, so reload once to recreate the client: if the
        // session was real, the reload restores it and chat loads; if genuinely
        // absent, the post-reload pass is still null and falls through to /login.
        // The sessionStorage flag caps this at a single reload (no infinite loop).
        if (!sessionStorage.getItem(AUTH_RELOAD_FLAG)) {
          sessionStorage.setItem(AUTH_RELOAD_FLAG, "1");
          window.location.reload();
          return;
        }
        sessionStorage.removeItem(AUTH_RELOAD_FLAG);
        if (isMounted) router.replace("/login");
        return;
      }
      // Valid session: clear the guard so a future stale event can self-heal again.
      sessionStorage.removeItem(AUTH_RELOAD_FLAG);
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
      <div className="min-h-screen flex items-center justify-center">
        <AIOrb size={64} variant="soft" />
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
    <div className="min-h-screen flex flex-col" style={{ fontFamily: FONT }}>

      {/* ── HEADER ── */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3"
        style={{
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: "blur(20px) saturate(1.4)",
          borderBottom: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors border border-white/75"
            style={{ background: "rgba(255,255,255,0.7)" }}
          >
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex items-center gap-2.5">
            <AIOrb size={26} />
            <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-black" style={{ fontFamily: FONT }}>
                Noor AI
              </span>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/70 border border-white/75 text-gray-500"
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
            {/* Orb + serif greeting */}
            <div className="mb-10 flex flex-col items-center text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="mb-8"
              >
                <AIOrb size={110} halo />
              </motion.div>
              <h2
                className="text-[34px] leading-[1.15]"
                style={{ fontFamily: SERIF, letterSpacing: "-0.02em", color: "#000000" }}
              >
                {userName ? `Hello ${userName}` : "Hello"}
              </h2>
              <p
                className="text-[30px] leading-snug text-black"
                style={{ fontFamily: SERIF, letterSpacing: "-0.02em" }}
              >
                How can I help you today?
              </p>
              <p className="text-[14px] text-gray-500 mt-3 leading-relaxed" style={{ fontFamily: FONT }}>
                Banking, credit, budgeting, taxes — I know your profile.
              </p>
            </div>

            {/* Prompts as frosted rows */}
            <div className="space-y-2">
              {quickPrompts.slice(0, 6).map((p, i) => (
                <motion.button
                  key={i}
                  onClick={() => void handleSend(p.prompt)}
                  className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-left group"
                  style={{
                    background: "rgba(255,255,255,0.62)",
                    border: "1px solid rgba(255,255,255,0.75)",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                  }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.055, duration: 0.3 }}
                  whileHover={{ background: "rgba(255,255,255,0.85)" }}
                  whileTap={{ scale: 0.99 }}
                >
                  <span className="text-[13.5px] text-black" style={{ fontFamily: FONT }}>
                    {p.label}
                  </span>
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      <div className="flex-shrink-0 mb-0.5">
                        <AIOrb size={24} />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] px-4 py-3 text-[14px] leading-relaxed ${
                        isUser ? "rounded-2xl rounded-br-[5px]" : "rounded-2xl rounded-bl-[5px]"
                      }`}
                      style={{
                        fontFamily: FONT,
                        ...(isUser
                          ? {
                              background: "#000000",
                              color: "#FFFFFF",
                              boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
                            }
                          : {
                              background: "rgba(255,255,255,0.7)",
                              border: "1px solid rgba(255,255,255,0.75)",
                              color: "#000000",
                              backdropFilter: "blur(16px)",
                              WebkitBackdropFilter: "blur(16px)",
                            }),
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
                  <div className="flex-shrink-0 mb-0.5">
                    <AIOrb size={24} />
                  </div>
                  <div
                    className="px-4 py-3.5 rounded-2xl rounded-bl-[5px]"
                    style={{
                      background: "rgba(255,255,255,0.7)",
                      border: "1px solid rgba(255,255,255,0.75)",
                    }}
                  >
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
          style={{ background: "linear-gradient(to top, rgba(246,244,251,0.95) 60%, rgba(246,244,251,0))" }}
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
                    background: "rgba(255,255,255,0.8)",
                    border: "1px solid rgba(255,255,255,0.75)",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
                    color: "#5C5878",
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
            background: "rgba(255,255,255,0.8)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            border: `1px solid ${isFocused ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.75)"}`,
            borderRadius: "100px",
            padding: "7px 7px 7px 18px",
            boxShadow: isFocused
              ? "0 8px 28px rgba(0,0,0,0.22)"
              : "0 6px 20px rgba(0,0,0,0.12)",
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
            placeholder="Ask about banking, credit, taxes…"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-gray-400"
            style={{ fontFamily: FONT, color: "#000000" }}
          />

          <motion.button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: input.trim() && !isLoading ? "#000000" : "rgba(0,0,0,0.08)",
              boxShadow: input.trim() && !isLoading ? "0 4px 14px rgba(0,0,0,0.28)" : "none",
              transition: "background 0.18s, box-shadow 0.18s",
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
                  stroke={input.trim() ? "white" : "rgba(0,0,0,0.3)"}
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
