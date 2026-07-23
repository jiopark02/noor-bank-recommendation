'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MAX_DEMO_MESSAGES,
  WAITLIST_URL,
  DemoShell,
  DemoButton,
  DEMO_BUTTON_CLASS,
  demoButtonStyle,
  INK,
  LINE,
  SURFACE,
  getCannedAnswer,
  getDemoMessagesUsed,
  incrementDemoMessagesUsed,
} from '../_lib';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

const OPENING: ChatMsg = {
  role: 'assistant',
  text: "Hi, I'm Noor. Ask me anything about budgeting, credit, saving, or banking — this demo runs on your sample profile.",
};

export default function DemoChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([OPENING]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [used, setUsed] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUsed(getDemoMessagesUsed());
    const queued = sessionStorage.getItem('noor_demo_quick_prompt');
    if (queued) {
      sessionStorage.removeItem('noor_demo_quick_prompt');
      setDraft(queued);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const capped = used >= MAX_DEMO_MESSAGES;

  const send = (rawText?: string) => {
    const text = (rawText ?? draft).trim();
    if (!text || capped) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setDraft('');
    setTyping(true);

    const nextUsed = incrementDemoMessagesUsed();
    setUsed(nextUsed);

    window.setTimeout(() => {
      setTyping(false);
      setMessages((prev) => [...prev, { role: 'assistant', text: getCannedAnswer(text) }]);
    }, 900);
  };

  return (
    <DemoShell>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Noor AI</h1>
        <p className="text-sm mt-1" style={{ color: INK.muted }}>
          {MAX_DEMO_MESSAGES - used > 0
            ? `${MAX_DEMO_MESSAGES - used} message${MAX_DEMO_MESSAGES - used === 1 ? '' : 's'} left in this demo.`
            : "You've used all your demo messages."}
        </p>
      </header>

      <div
        className="rounded-2xl flex flex-col"
        style={{ border: `1px solid ${LINE.default}`, height: '52vh', minHeight: 360 }}
      >
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === 'user' ? 'rounded-2xl rounded-br-[4px]' : 'rounded-2xl rounded-bl-[4px]'
                  }`}
                  style={msg.role === 'user' ? { background: '#000', color: '#fff' } : { background: '#F2F2F2', color: '#000' }}
                >
                  {msg.text}
                </div>
              </motion.div>
            ))}
            {typing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="rounded-2xl rounded-bl-[4px] px-4 py-3 bg-[#F2F2F2] flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-[#BDBDBD]"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {capped && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-4 text-center"
              style={{ background: SURFACE.subtle, border: `1px solid ${LINE.default}` }}
            >
              <p className="text-[13px] mb-3">You&rsquo;re on the demo — join the waitlist for full access.</p>
              <a
                href={WAITLIST_URL}
                className={DEMO_BUTTON_CLASS}
                style={demoButtonStyle('solid')}
              >
                Join waitlist
              </a>
            </motion.div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2 p-3" style={{ borderTop: `1px solid ${LINE.hairline}` }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            disabled={capped}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={capped ? 'Demo message limit reached' : 'Ask Noor anything...'}
            className="flex-1 border rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              borderColor: inputFocused ? INK.primary : LINE.default,
              background: capped ? SURFACE.subtle : undefined,
              color: capped ? INK.muted : undefined,
            }}
          />
          <DemoButton
            variant="solid"
            onClick={() => send()}
            disabled={capped || !draft.trim()}
            className="w-10 h-10 !px-0 disabled:opacity-40"
            aria-label="Send"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </DemoButton>
        </div>
      </div>
    </DemoShell>
  );
}
