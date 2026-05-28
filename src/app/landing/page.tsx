'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useSpring,
  useInView,
  useTransform,
} from 'framer-motion';
import { useRouter } from 'next/navigation';

const FONT = "'SF Pro Display', 'Helvetica Neue', -apple-system, Inter, sans-serif";
const ACCENT = '#5B4EE8';
const ACCENT_GRADIENT = 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)';

const SECTIONS = [
  { id: 'meet', number: '01', label: 'MEET NOOR' },
  { id: 'outcome', number: '02', label: 'NOOR OWNS THE OUTCOME' },
  { id: 'intelligence', number: '03', label: 'AI INTELLIGENCE' },
  { id: 'universities', number: '04', label: 'UNIVERSITIES' },
  { id: 'start', number: '05', label: 'GET STARTED' },
];

const BANK_MATCHES = [
  { name: 'Chase Total Checking', score: 98, tag: 'Best Match' },
  { name: 'Bank of America Core', score: 91, tag: 'Low Fees' },
  { name: 'Wells Fargo Everyday', score: 84, tag: 'Most Branches' },
];

const STEPS = [
  { step: '01', title: 'Tell us about yourself', desc: 'Quick survey — your goals, situation, and university.' },
  { step: '02', title: 'Noor analyzes', desc: 'AI matches your profile against fees, branches, and requirements.' },
  { step: '03', title: 'Open your account', desc: 'Click through to your best match. Done in minutes.' },
];

const CAPABILITIES = [
  { label: 'No SSN Required', desc: 'Finds banks that accept ITIN and passport' },
  { label: 'Fee Analysis', desc: 'Compares maintenance, ATM charges, overdraft' },
  { label: 'Branch Proximity', desc: 'Maps nearest branches to your campus' },
  { label: 'Student Perks', desc: 'Waivers, cashback, and sign-on offers' },
];

const UNIVERSITIES_MARQUEE = [
  'Stanford', 'MIT', 'Harvard', 'UC Berkeley', 'UCLA', 'NYU',
  'Columbia', 'Yale', 'Princeton', 'Cornell', 'UT Austin', 'UMich',
  'Duke', 'Northwestern', 'Georgetown', 'USC', 'Carnegie Mellon', 'BU',
];

// ── Animation variants ─────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.72,
      delay: i * 0.1,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

// ── Count-up number ────────────────────────────────────────────────────────

function CountUp({ to, inView }: { to: number; inView: boolean }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const duration = 900;
    const raf = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(ease * to));
      if (t < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [inView, to]);
  return <>{val}</>;
}

// ── Animated AI chat demo ──────────────────────────────────────────────────

const CHAT_MESSAGES = [
  { role: 'user' as const, text: 'Which bank is best for international students?' },
  { role: 'assistant' as const, text: 'Chase Total Checking is your top match — zero monthly fees, accepts ITIN or passport, and ATMs on nearly every campus.' },
  { role: 'user' as const, text: "What if I don't have an SSN yet?" },
  { role: 'assistant' as const, text: "No problem. Chase and HSBC both open accounts with just a passport and enrollment letter. I've saved this to your recommendations." },
];

type ChatMsg = typeof CHAT_MESSAGES[number];

const CHAT_STEPS: Array<{
  run: (s: React.Dispatch<React.SetStateAction<ChatMsg[]>>, t: React.Dispatch<React.SetStateAction<boolean>>) => void;
  delay: number;
}> = [
  { run: (s) => s([CHAT_MESSAGES[0]]), delay: 800 },
  { run: (_, t) => t(true), delay: 1400 },
  { run: (s, t) => { t(false); s([CHAT_MESSAGES[0], CHAT_MESSAGES[1]]); }, delay: 2000 },
  { run: (s) => s(p => [...p, CHAT_MESSAGES[2]]), delay: 800 },
  { run: (_, t) => t(true), delay: 1400 },
  { run: (s, t) => { t(false); s(CHAT_MESSAGES); }, delay: 3200 },
  { run: (s, t) => { s([]); t(false); }, delay: 900 },
];

function AnimatedChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [cycle, setCycle] = useState(0);
  const stepRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const run = () => {
      const step = CHAT_STEPS[stepRef.current];
      step.run(setMessages, setTyping);
      if (stepRef.current === CHAT_STEPS.length - 1) setCycle(c => c + 1);
      stepRef.current = (stepRef.current + 1) % CHAT_STEPS.length;
      timerRef.current = setTimeout(run, step.delay);
    };
    timerRef.current = setTimeout(run, 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="flex flex-col gap-2.5 p-4 overflow-hidden">
      <AnimatePresence>
        {messages.map((msg, i) => (
          <motion.div
            key={`${cycle}-${i}`}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5 bg-black">
                <span className="text-[9px] font-semibold text-white" style={{ fontFamily: FONT, letterSpacing: '0.08em' }}>N</span>
              </div>
            )}
            <div
              className={`max-w-[78%] px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                msg.role === 'user' ? 'rounded-2xl rounded-br-[4px]' : 'rounded-2xl rounded-bl-[4px]'
              }`}
              style={{
                ...(msg.role === 'user'
                  ? { background: '#000', color: '#FFF' }
                  : { background: '#F2F2F2', color: '#000' }),
                fontFamily: FONT,
              }}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}
        {typing && (
          <motion.div
            key="typing"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="flex items-end gap-2"
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5 bg-black">
              <span className="text-[9px] font-semibold text-white" style={{ fontFamily: FONT, letterSpacing: '0.08em' }}>N</span>
            </div>
            <div className="rounded-2xl rounded-bl-[4px] px-3.5 py-3 bg-[#F2F2F2]">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="rounded-full bg-[#BDBDBD]"
                    style={{ width: 6, height: 6 }}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Section badge ──────────────────────────────────────────────────────────

function SectionBadge({ label }: { label: string }) {
  return (
    <motion.div variants={fadeUp} className="flex items-center gap-2.5 mb-10">
      <motion.div
        className="w-[6px] h-[6px] rounded-full"
        style={{ background: ACCENT, boxShadow: `0 0 6px rgba(91,78,232,0.6)` }}
        animate={{ scale: [1, 1.5, 1], boxShadow: [`0 0 6px rgba(91,78,232,0.6)`, `0 0 12px rgba(91,78,232,0.8)`, `0 0 6px rgba(91,78,232,0.6)`] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span style={{ fontFamily: FONT, fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.15em', color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>
        {label}
      </span>
    </motion.div>
  );
}

// ── Hover card wrapper ─────────────────────────────────────────────────────

const HoverCard = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string; style?: React.CSSProperties }>(
  function HoverCard({ children, className, style }, ref) {
    return (
      <motion.div
        ref={ref}
        className={className}
        style={style}
        whileHover={{ y: -3, boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    );
  }
);

// ── Main page ──────────────────────────────────────────────────────────────

export default function LandingPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState('meet');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { scrollYProgress } = useScroll();
  const progressScaleX = useSpring(scrollYProgress, { stiffness: 160, damping: 30 });

  // Hero parallax
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, -60]);

  // Bank card in-view for count-up
  const bankRef = useRef<HTMLDivElement>(null);
  const bankInView = useInView(bankRef, { once: true, margin: '-60px' });

  useEffect(() => {
    setIsLoggedIn(Boolean(localStorage.getItem('noor_user_id')));
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id); }),
      { threshold: 0.3 }
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  const headingStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 'clamp(3rem, 6.5vw, 5.5rem)',
    fontWeight: 300,
    lineHeight: 0.97,
    letterSpacing: '-0.03em',
  };

  return (
    <div className="min-h-screen bg-white text-black overflow-x-hidden" style={{ fontFamily: FONT }}>

      {/* ── SCROLL PROGRESS BAR ── */}
      <motion.div
        className="fixed top-0 left-0 right-0 z-[60] h-[2px] origin-left"
        style={{ scaleX: progressScaleX, background: ACCENT_GRADIENT }}
      />

      {/* ── TOP NAV ── */}
      <motion.nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-[18px]"
        style={{
          borderBottom: '1px solid rgba(0,0,0,0.07)',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <button onClick={() => scrollTo('meet')} className="flex items-center gap-2.5">
          <div className="w-[26px] h-[26px] rounded flex items-center justify-center" style={{ background: ACCENT_GRADIENT }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 0.5L11.5 6L6 11.5L0.5 6L6 0.5Z" fill="white" />
            </svg>
          </div>
          <span style={{ fontFamily: FONT, letterSpacing: '0.22em', fontSize: '12.5px', fontWeight: 600 }}>NOOR</span>
        </button>

        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <motion.button
              onClick={() => router.push('/dashboard')}
              className="px-5 py-2 text-[13px] font-medium rounded-lg"
              style={{ background: ACCENT_GRADIENT, color: '#FFF', fontFamily: FONT, boxShadow: `0 2px 12px rgba(91,78,232,0.35)` }}
              whileHover={{ scale: 1.04, boxShadow: `0 4px 20px rgba(91,78,232,0.45)` }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.18 }}
            >
              Go to Dashboard
            </motion.button>
          ) : (
            <>
              <motion.button
                onClick={() => router.push('/login')}
                className="px-5 py-2 text-[13px] rounded-lg"
                style={{ color: 'rgba(0,0,0,0.45)', fontFamily: FONT }}
                whileHover={{ color: '#000' }}
              >
                Login
              </motion.button>
              <motion.button
                onClick={() => router.push('/welcome')}
                className="px-5 py-2 text-[13px] font-medium rounded-lg"
                style={{ background: ACCENT_GRADIENT, color: '#FFF', fontFamily: FONT, boxShadow: `0 2px 12px rgba(91,78,232,0.35)` }}
                whileHover={{ scale: 1.04, boxShadow: `0 4px 20px rgba(91,78,232,0.45)` }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.18 }}
              >
                Get Started
              </motion.button>
            </>
          )}
        </div>
      </motion.nav>

      {/* ── MAIN LAYOUT ── */}
      <div style={{ paddingTop: '61px' }}>

        {/* ── LEFT SIDEBAR (fixed) ── */}
        <motion.div
          className="hidden lg:flex flex-col justify-center"
          style={{ position: 'fixed', top: '61px', left: 0, bottom: 0, width: '272px', zIndex: 40, borderRight: '1px solid rgba(0,0,0,0.07)', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
        >
          <div className="absolute top-8 left-8">
            <span style={{ fontFamily: FONT, fontSize: '9.5px', fontWeight: 500, letterSpacing: '0.2em', color: 'rgba(0,0,0,0.2)', textTransform: 'uppercase' }}>
              Navigation
            </span>
          </div>

          <nav className="px-8 space-y-0">
            {SECTIONS.map(({ id, number, label }) => {
              const active = activeSection === id;
              return (
                <motion.button
                  key={id}
                  onClick={() => scrollTo(id)}
                  className="group flex items-center gap-3 w-full py-[10px] text-left"
                  whileHover={{ x: 3 }}
                  transition={{ duration: 0.18 }}
                >
                  <motion.div
                    className="flex-shrink-0 rounded-full"
                    animate={{
                      width: active ? 8 : 6,
                      height: active ? 8 : 6,
                      background: active ? ACCENT : 'rgba(0,0,0,0)',
                      border: active ? '1px solid rgba(0,0,0,0)' : '1px solid rgba(0,0,0,0.22)',
                      boxShadow: active ? `0 0 8px rgba(91,78,232,0.5)` : '0 0 0px rgba(0,0,0,0)',
                    }}
                    transition={{ duration: 0.2 }}
                  />
                  <span
                    className="text-[10.5px] font-medium uppercase transition-colors duration-200"
                    style={{
                      letterSpacing: '0.1em',
                      color: active ? ACCENT : 'rgba(0,0,0,0.28)',
                      fontFamily: FONT,
                    }}
                  >
                    {number}&nbsp;&nbsp;{label}
                  </span>
                </motion.button>
              );
            })}
          </nav>

          <div className="absolute bottom-8 left-8 right-8">
            <p className="text-[10.5px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.18)', fontFamily: FONT }}>
              Banking guidance for<br />new arrivals &amp; students.
            </p>
          </div>
        </motion.div>

        {/* ── RIGHT CONTENT ── */}
        <div className="lg:ml-[272px]">

          {/* ─────────────────────────────────────────────────────────────
              01  MEET NOOR
          ───────────────────────────────────────────────────────────── */}
          <section
            ref={heroRef}
            id="meet"
            className="relative min-h-screen flex flex-col justify-center px-10 lg:px-16 py-28 overflow-hidden"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.055) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          >
            {/* Dot-grid fade overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0.95) 100%)' }}
            />

            {/* Animated blobs */}
            <motion.div
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 520, height: 520,
                background: 'radial-gradient(circle, rgba(91,78,232,0.07) 0%, transparent 70%)',
                filter: 'blur(55px)',
                top: -160, right: -80,
              }}
              animate={{ x: [0, 45, -25, 0], y: [0, -35, 25, 0], scale: [1, 1.06, 0.94, 1] }}
              transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 360, height: 360,
                background: 'radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 70%)',
                filter: 'blur(40px)',
                bottom: 0, left: '30%',
              }}
              animate={{ x: [0, -30, 20, 0], y: [0, 30, -20, 0], scale: [1, 0.92, 1.08, 1] }}
              transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
            />

            <motion.div
              className="relative max-w-[780px]"
              style={{ y: heroY }}
              variants={stagger}
              initial="hidden"
              animate="visible"
            >
              <SectionBadge label="Meet Noor" />

              <motion.h1 style={headingStyle} className="mb-10" variants={fadeUp} custom={1}>
                <span style={{ color: '#000' }}>NOOR </span>
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>sees your</span>
                <br />
                <span style={{ color: '#000' }}>situation </span>
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>and</span>
                <br />
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>guides you</span>
                <br />
                <span style={{ color: '#000' }}>flawlessly.</span>
              </motion.h1>

              <motion.p
                className="text-[15px] leading-[1.75] mb-14"
                style={{ color: 'rgba(0,0,0,0.45)', maxWidth: '460px', fontFamily: FONT }}
                variants={fadeUp}
                custom={2}
              >
                Noor is an AI-powered financial guide for new arrivals and international students. It reads your situation, maps the market, and surfaces the exact bank that fits — no confusion, no fees, just clarity.
              </motion.p>

              {/* Preview cards */}
              <motion.div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px]" variants={stagger}>
                {/* Bank match card */}
                <motion.div variants={fadeUp} custom={3}>
                  <HoverCard
                    ref={bankRef as React.Ref<HTMLDivElement>}
                    className="p-5 rounded-2xl"
                    style={{ border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}
                  >
                    <div className="text-[9.5px] font-medium uppercase mb-4" style={{ letterSpacing: '0.15em', color: 'rgba(0,0,0,0.3)', fontFamily: FONT }}>
                      AI Bank Match
                    </div>
                    <div className="space-y-1.5">
                      {BANK_MATCHES.map((bank) => (
                        <div key={bank.name} className="flex items-center justify-between py-2 px-3 rounded-xl" style={{ background: 'rgba(0,0,0,0.04)' }}>
                          <div>
                            <span className="block text-[12px]" style={{ color: '#000', fontFamily: FONT }}>{bank.name}</span>
                            <span className="text-[10.5px]" style={{ color: 'rgba(0,0,0,0.32)', fontFamily: FONT }}>{bank.tag}</span>
                          </div>
                          <span className="text-[13px] font-semibold tabular-nums" style={{ color: ACCENT, fontFamily: FONT }}>
                            <CountUp to={bank.score} inView={bankInView} />%
                          </span>
                        </div>
                      ))}
                    </div>
                  </HoverCard>
                </motion.div>

                {/* Chat preview card */}
                <motion.div variants={fadeUp} custom={4}>
                  <HoverCard
                    className="p-5 rounded-2xl"
                    style={{ border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}
                  >
                    <div className="text-[9.5px] font-medium uppercase mb-4" style={{ letterSpacing: '0.15em', color: 'rgba(0,0,0,0.3)', fontFamily: FONT }}>
                      AI Assistant
                    </div>
                    <div className="space-y-3">
                      <div className="py-2.5 px-3.5 rounded-2xl rounded-br-[4px] text-[12.5px] leading-relaxed text-right ml-8" style={{ background: '#000', color: '#FFF', fontFamily: FONT }}>
                        "Which bank is best for international students with no SSN?"
                      </div>
                      <div className="py-2.5 px-3.5 rounded-2xl rounded-bl-[4px] text-[12px] leading-relaxed mr-8" style={{ background: '#F2F2F2', color: '#000', fontFamily: FONT }}>
                        Chase Total Checking is your top match — zero monthly fees, accepts ITIN or passport...
                      </div>
                    </div>
                  </HoverCard>
                </motion.div>
              </motion.div>
            </motion.div>
          </section>

          {/* ─────────────────────────────────────────────────────────────
              02  NOOR OWNS THE OUTCOME
          ───────────────────────────────────────────────────────────── */}
          <section id="outcome" className="min-h-screen flex flex-col justify-center px-10 lg:px-16 py-28" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <motion.div
              className="max-w-[780px]"
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
            >
              <SectionBadge label="Noor Owns the Outcome" />

              <motion.h2 style={headingStyle} className="mb-10" variants={fadeUp} custom={1}>
                <span style={{ color: '#000' }}>We find</span>
                <br />
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>your match.</span>
                <br />
                <span style={{ color: '#000' }}>You just</span>
                <br />
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>show up.</span>
              </motion.h2>

              <motion.p
                className="text-[15px] leading-[1.75] mb-14"
                style={{ color: 'rgba(0,0,0,0.45)', maxWidth: '460px', fontFamily: FONT }}
                variants={fadeUp} custom={2}
              >
                No fee tables, no fine print, no guesswork. Noor maps your profile against every bank, surfaces the ones that genuinely fit, and tells you exactly why.
              </motion.p>

              <motion.div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-[640px]" variants={stagger}>
                {STEPS.map((item, i) => (
                  <motion.div key={item.step} variants={fadeUp} custom={i + 3}>
                    <HoverCard
                      className="p-5 rounded-2xl h-full"
                      style={{ border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}
                    >
                      <div className="text-[10px] font-mono mb-3" style={{ letterSpacing: '0.15em', color: 'rgba(0,0,0,0.18)' }}>{item.step}</div>
                      <div className="text-[13px] font-medium mb-2" style={{ color: '#000', fontFamily: FONT }}>{item.title}</div>
                      <div className="text-[12px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.38)', fontFamily: FONT }}>{item.desc}</div>
                    </HoverCard>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          </section>

          {/* ─────────────────────────────────────────────────────────────
              03  AI INTELLIGENCE
          ───────────────────────────────────────────────────────────── */}
          <section
            id="intelligence"
            className="relative min-h-screen flex flex-col justify-center px-10 lg:px-16 py-28 overflow-hidden"
            style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
          >
            {/* Subtle background pulse */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse 60% 50% at 70% 50%, rgba(0,0,0,0.025) 0%, transparent 100%)' }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            />

            <motion.div
              className="relative max-w-[780px]"
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
            >
              <SectionBadge label="AI Intelligence" />

              <motion.h2 style={headingStyle} className="mb-10" variants={fadeUp} custom={1}>
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>Built on</span>
                <br />
                <span style={{ color: '#000' }}>real banking</span>
                <br />
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>intelligence.</span>
              </motion.h2>

              <motion.p
                className="text-[15px] leading-[1.75] mb-12"
                style={{ color: 'rgba(0,0,0,0.45)', maxWidth: '460px', fontFamily: FONT }}
                variants={fadeUp} custom={2}
              >
                Powered by Claude AI, Noor understands nuanced financial situations. Ask it anything — it responds like a knowledgeable friend who actually knows banking.
              </motion.p>

              <motion.div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-[680px]" variants={stagger}>
                {/* Animated chat window */}
                <motion.div variants={fadeUp} custom={3}>
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                      border: '1px solid rgba(0,0,0,0.08)',
                      background: '#FFF',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
                    }}
                  >
                    {/* Chat header */}
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center">
                          <span className="text-[9px] font-semibold text-white" style={{ fontFamily: FONT, letterSpacing: '0.08em' }}>N</span>
                        </div>
                        <div>
                          <div className="text-[12px] font-medium" style={{ fontFamily: FONT }}>Noor AI</div>
                          <div className="flex items-center gap-1">
                            <motion.div
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: '#22C55E' }}
                              animate={{ opacity: [1, 0.4, 1] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                            <span className="text-[10px]" style={{ color: 'rgba(0,0,0,0.4)', fontFamily: FONT }}>Active</span>
                          </div>
                        </div>
                      </div>
                      {/* Window dots */}
                      <div className="flex gap-1.5">
                        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
                          <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                        ))}
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="h-[240px] overflow-hidden">
                      <AnimatedChat />
                    </div>

                    {/* Input */}
                    <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      <div className="flex-1 px-3 py-2 rounded-xl text-[12px]" style={{ background: 'rgba(0,0,0,0.04)', color: 'rgba(0,0,0,0.3)', fontFamily: FONT }}>
                        Ask Noor anything...
                      </div>
                      <motion.div
                        className="w-7 h-7 rounded-lg bg-black flex items-center justify-center cursor-pointer"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.92 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </motion.div>
                    </div>
                  </div>
                </motion.div>

                {/* Capability list */}
                <motion.div className="flex flex-col gap-3 justify-center" variants={stagger}>
                  {CAPABILITIES.map((item, i) => (
                    <motion.div key={item.label} variants={fadeUp} custom={i}>
                      <HoverCard
                        className="p-4 rounded-xl flex gap-3"
                        style={{ border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}
                      >
                        <motion.div
                          className="w-[6px] h-[6px] rounded-full flex-shrink-0 mt-[5px]"
                          style={{ background: ACCENT }}
                          animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                          transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.6 }}
                        />
                        <div>
                          <div className="text-[13px] font-medium mb-0.5" style={{ color: '#000', fontFamily: FONT }}>{item.label}</div>
                          <div className="text-[12px] leading-relaxed" style={{ color: 'rgba(0,0,0,0.38)', fontFamily: FONT }}>{item.desc}</div>
                        </div>
                      </HoverCard>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>
            </motion.div>
          </section>

          {/* ─────────────────────────────────────────────────────────────
              04  UNIVERSITIES
          ───────────────────────────────────────────────────────────── */}
          <section id="universities" className="min-h-screen flex flex-col justify-center py-28 overflow-hidden" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <motion.div
              className="px-10 lg:px-16 max-w-[780px]"
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
            >
              <SectionBadge label="Universities" />

              <motion.h2 style={headingStyle} className="mb-10" variants={fadeUp} custom={1}>
                <span style={{ color: '#000' }}>Tailored for</span>
                <br />
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>50+ university</span>
                <br />
                <span style={{ color: '#000' }}>campuses.</span>
              </motion.h2>

              <motion.p
                className="text-[15px] leading-[1.75] mb-14"
                style={{ color: 'rgba(0,0,0,0.45)', maxWidth: '460px', fontFamily: FONT }}
                variants={fadeUp} custom={2}
              >
                Noor adapts its recommendations to your specific campus — because the best bank near MIT is different from the best bank near UCLA.
              </motion.p>
            </motion.div>

            {/* Infinite marquee */}
            <motion.div
              className="relative mb-6 overflow-hidden"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              style={{ maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)' }}
            >
              <motion.div
                className="flex gap-3 w-max"
                animate={{ x: ['0%', '-50%'] }}
                transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
              >
                {[...UNIVERSITIES_MARQUEE, ...UNIVERSITIES_MARQUEE].map((uni, i) => (
                  <div
                    key={i}
                    className="px-4 py-2 rounded-full text-[12px] flex-shrink-0"
                    style={{ border: '1px solid rgba(0,0,0,0.12)', color: 'rgba(0,0,0,0.5)', fontFamily: FONT }}
                  >
                    {uni}
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Second marquee (reverse) */}
            <motion.div
              className="relative overflow-hidden"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.45 }}
              style={{ maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)' }}
            >
              <motion.div
                className="flex gap-3 w-max"
                animate={{ x: ['-50%', '0%'] }}
                transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
              >
                {[...UNIVERSITIES_MARQUEE.slice(6), ...UNIVERSITIES_MARQUEE, ...UNIVERSITIES_MARQUEE.slice(6)].map((uni, i) => (
                  <div
                    key={i}
                    className="px-4 py-2 rounded-full text-[12px] flex-shrink-0"
                    style={{ border: '1px solid rgba(0,0,0,0.07)', color: 'rgba(0,0,0,0.3)', fontFamily: FONT }}
                  >
                    {uni}
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </section>

          {/* ─────────────────────────────────────────────────────────────
              05  GET STARTED
          ───────────────────────────────────────────────────────────── */}
          <section
            id="start"
            className="relative min-h-screen flex flex-col justify-center px-10 lg:px-16 py-28 overflow-hidden"
            style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
          >
            {/* Background dot grid (inverted density) */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.045) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.5) 40%, rgba(255,255,255,0.85) 100%)' }}
            />

            <motion.div
              className="relative max-w-[780px]"
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-80px' }}
            >
              <SectionBadge label="Get Started" />

              <motion.h2 style={headingStyle} className="mb-10" variants={fadeUp} custom={1}>
                <span style={{ color: 'rgba(0,0,0,0.25)' }}>Your bank</span>
                <br />
                <span style={{ color: '#000' }}>is waiting.</span>
              </motion.h2>

              <motion.p
                className="text-[15px] leading-[1.75] mb-12"
                style={{ color: 'rgba(0,0,0,0.45)', maxWidth: '460px', fontFamily: FONT }}
                variants={fadeUp} custom={2}
              >
                Three minutes. No account required to explore. No commitment until you&rsquo;re ready.
              </motion.p>

              <motion.div className="flex flex-wrap items-center gap-4" variants={fadeUp} custom={3}>
                {isLoggedIn ? (
                  <motion.button
                    onClick={() => router.push('/dashboard')}
                    className="px-8 py-3.5 text-[13px] font-medium rounded-xl"
                    style={{ background: ACCENT_GRADIENT, color: '#FFF', fontFamily: FONT, boxShadow: `0 4px 20px rgba(91,78,232,0.4)` }}
                    whileHover={{ scale: 1.04, boxShadow: `0 6px 28px rgba(91,78,232,0.5)` }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.18 }}
                  >
                    Go to Dashboard
                  </motion.button>
                ) : (
                  <>
                    <motion.button
                      onClick={() => router.push('/welcome')}
                      className="px-8 py-3.5 text-[13px] font-medium rounded-xl"
                      style={{ background: ACCENT_GRADIENT, color: '#FFF', fontFamily: FONT, boxShadow: `0 4px 20px rgba(91,78,232,0.4)` }}
                      whileHover={{ scale: 1.04, boxShadow: `0 6px 28px rgba(91,78,232,0.5)` }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.18 }}
                    >
                      Find My Bank
                    </motion.button>
                    <motion.button
                      onClick={() => router.push('/login')}
                      className="px-8 py-3.5 text-[13px] rounded-xl"
                      style={{ border: '1px solid rgba(0,0,0,0.18)', color: 'rgba(0,0,0,0.55)', fontFamily: FONT }}
                      whileHover={{ borderColor: 'rgba(0,0,0,0.6)', color: '#000', scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.18 }}
                    >
                      I have an account
                    </motion.button>
                  </>
                )}
              </motion.div>

              <motion.p
                className="text-[11.5px] mt-10"
                style={{ color: 'rgba(0,0,0,0.18)', fontFamily: FONT }}
                variants={fadeUp} custom={4}
              >
                Your data stays private. Always.
              </motion.p>
            </motion.div>
          </section>

        </div>
      </div>
    </div>
  );
}

