'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav } from '@/components/layout';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const STORAGE_KEY = 'noor_chat_history';

const QUICK_PROMPTS = [
  { id: 'credit', label: 'How do I build credit?' },
  { id: 'hysa', label: 'What is a HYSA?' },
  { id: 'roth', label: 'Can I open a Roth IRA?' },
  { id: 'savings', label: 'How should I save money?' },
];

const AI_RESPONSES: Record<string, string> = {
  credit: `Building credit as an international student is totally doable! Here's a simple approach:

**1. Start with a secured credit card**
Put down a deposit (usually $200-500) and use it like a regular credit card. Good options:
- Discover it Secured
- Capital One Platinum Secured

**2. Use it wisely**
- Keep spending under 30% of your limit
- Pay the full balance every month
- Set up autopay so you never miss a payment

**3. Give it time**
It takes about 6 months to build a score. After a year of good behavior, you can often upgrade to a regular card.

Would you like me to explain more about any of these steps?`,

  ssn: `Great question! **No, you don't need an SSN to open a bank account** in the US.

Most major banks accept international students with:
- Your passport
- Your I-20
- Your student ID
- Proof of address (like a lease or utility bill)

Some banks that are especially friendly to international students:
- **Bank of America** - Has branches near most campuses
- **Chase** - Good mobile app, lots of ATMs
- **Wells Fargo** - Also widely available

If you later get an SSN (from a campus job, for example), you can add it to your account.

Do you want me to help you choose a bank based on your school location?`,

  tax: `As an F-1 student, here's what you need for taxes:

**Forms you'll receive:**
- **W-2** - If you worked (campus job, etc.)
- **1042-S** - For scholarships/fellowships
- **1099** - For freelance income (if applicable)

**Forms you'll file:**
- **Form 8843** - Required for ALL F-1 students (even with no income)
- **1040-NR** - Non-resident tax return (if you have US income)

**Important dates:**
- Tax filing deadline: April 15
- Get your documents: January-February

**Free resources:**
- Many schools offer free tax prep for international students
- Sprintax is popular software for non-resident returns

Would you like more details about any specific form?`,

  opt: `OPT (Optional Practical Training) lets you work in the US after graduation. Here's the timeline:

**When to apply:**
- You can apply **90 days before** your program end date
- Up to **60 days after** your program ends

**Processing time:**
- USCIS typically takes **3-5 months** to process
- You CAN'T work until you receive your EAD card

**Duration:**
- Standard OPT: **12 months**
- STEM OPT Extension: Additional **24 months** (if your degree qualifies)

**Key deadlines:**
- Must have a job offer within **90 days** of OPT start
- Max **90 days** of unemployment total during OPT

**Pro tip:** Start your job search early! Many employers take time to verify work authorization.

Want me to explain CPT or the STEM extension in more detail?`,

  hysa: `**High-Yield Savings Accounts (HYSA)** are the best place for your emergency fund and short-term savings.

**Why HYSA?**
Regular checking accounts pay almost nothing (0.01%). HYSAs currently pay **4-5% APY**. That's real money!

**Example:** $5,000 in a HYSA = **~$225/year** in interest (vs. $0.50 in regular checking)

**Best HYSAs right now:**
- **Marcus (Goldman Sachs)** - 4.5% APY, no minimums
- **Ally Bank** - 4.2% APY, great app with savings buckets
- **SoFi** - 4.3% APY, all-in-one banking
- **Wealthfront** - 4.5% APY, good if you plan to invest too

**All of these:**
- Are FDIC insured (your money is safe)
- Have no monthly fees
- Accept international students
- Work entirely online

Want to see a comparison or learn how to open one?`,

  roth: `**Roth IRA** is one of the best retirement accounts for young people. Let me break it down:

**What is it?**
A retirement account where your money grows **tax-free forever**. You pay taxes on money going in, but never on gains or withdrawals.

**Why it's amazing for young people:**
- Your money has decades to grow tax-free
- You can withdraw contributions (not gains) anytime
- No required withdrawals ever

**2024 Limit:** $7,000/year

**Can YOU open one?**
- **F-1 Students (no work):** Usually NO - you need earned income
- **F-1 on OPT/CPT:** Maybe - depends on tax residency status
- **H-1B:** YES - if you have earned income
- **Green Card/Citizen:** YES

**Best providers:**
- **Fidelity** - No minimums, zero-fee index funds
- **Schwab** - Great research, physical branches
- **Vanguard** - Pioneer of low-cost investing

Want me to check if you're eligible? Go to the **Grow** section in the app!`,

  savings: `Here's how to think about **saving money** as an international student:

**Priority Order:**
1. **Emergency Fund First** - 3-6 months of expenses ($2,000-$5,000 minimum)
2. **HYSA for Safety** - Keep emergency fund in a high-yield savings account
3. **Retirement (if eligible)** - Roth IRA after you have income & tax residency

**Where to keep your money:**
- **Checking Account** - Just enough for monthly bills
- **High-Yield Savings** - Emergency fund + short-term savings
- **Roth IRA** - Long-term retirement (if eligible)

**The #1 mistake:** Keeping too much in checking accounts earning 0%!

**Quick win:** Move savings to a HYSA and earn 4-5% instead of 0%.

Check out the **Grow** tab in Noor for:
- HYSA comparisons
- Savings goal tracker
- Roth IRA eligibility quiz`,

  invest: `**Investing basics** for international students:

**Before you invest:**
1. Have an emergency fund (3-6 months expenses)
2. No high-interest debt (credit cards paid off)
3. Understand your tax situation

**For beginners, keep it simple:**
- **Target-date funds** - Set it and forget it, automatically diversified
- **Index funds (S&P 500)** - Low fees, follows the market
- **Example:** VTI (total stock market), VOO (S&P 500)

**Where to invest:**
- **Roth IRA** first (if eligible) - Tax-free growth!
- **Taxable brokerage** - After maxing IRA, or if not eligible for IRA

**Best platforms:**
- **Fidelity** - Best for beginners, no minimums
- **Schwab** - Good all-around
- **Vanguard** - Great for buy-and-hold

**The most important rule:** Time in the market > timing the market. Start early, be consistent.

Want to learn more about a specific topic?`,
};

const DEFAULT_RESPONSE = `I understand you're asking about that topic. As an AI assistant focused on helping international students, I can help with:

- **Banking** - Opening accounts, building credit, transferring money
- **Visa** - F-1 status, OPT, CPT, travel rules
- **Housing** - Finding apartments, understanding leases
- **Taxes** - Filing requirements, forms, deadlines
- **Jobs** - On-campus work, CPT/OPT employment
- **Savings** - HYSA, emergency funds, Roth IRA

Could you tell me more about what you'd like to know? I'm here to help!`;

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const userId = localStorage.getItem('noor_user_id');
    if (!userId) {
      router.push('/welcome');
      return;
    }

    // Load chat history
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMessages(parsed.map((m: Message) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })));
      } catch (e) {
        // ignore
      }
    }

    // Check for quick prompt from home page
    const quickPrompt = localStorage.getItem('noor_quick_prompt');
    if (quickPrompt) {
      localStorage.removeItem('noor_quick_prompt');
      setInput(quickPrompt);
      // Auto-submit after a short delay
      setTimeout(() => {
        handleSend(quickPrompt);
      }, 500);
    }
  }, [router]);

  useEffect(() => {
    // Save messages to localStorage
    if (messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  useEffect(() => {
    // Scroll to bottom on new messages
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const generateResponse = (userMessage: string): string => {
    const lowerMessage = userMessage.toLowerCase();

    if (lowerMessage.includes('credit') || lowerMessage.includes('credit card') || lowerMessage.includes('build credit')) {
      return AI_RESPONSES.credit;
    }
    if (lowerMessage.includes('ssn') || lowerMessage.includes('social security')) {
      return AI_RESPONSES.ssn;
    }
    if (lowerMessage.includes('tax') || lowerMessage.includes('1040') || lowerMessage.includes('8843')) {
      return AI_RESPONSES.tax;
    }
    if (lowerMessage.includes('opt') || lowerMessage.includes('cpt') || lowerMessage.includes('work authorization')) {
      return AI_RESPONSES.opt;
    }
    // Savings & Investing responses
    if (lowerMessage.includes('hysa') || lowerMessage.includes('high yield') || lowerMessage.includes('high-yield') || lowerMessage.includes('savings account')) {
      return AI_RESPONSES.hysa;
    }
    if (lowerMessage.includes('roth') || lowerMessage.includes('ira') || lowerMessage.includes('retirement')) {
      return AI_RESPONSES.roth;
    }
    if (lowerMessage.includes('sav') || lowerMessage.includes('emergency fund')) {
      return AI_RESPONSES.savings;
    }
    if (lowerMessage.includes('invest') || lowerMessage.includes('stock') || lowerMessage.includes('index fund') || lowerMessage.includes('401k') || lowerMessage.includes('401(k)')) {
      return AI_RESPONSES.invest;
    }

    return DEFAULT_RESPONSE;
  };

  const handleSend = async (messageText?: string) => {
    const text = messageText || input.trim();
    if (!text) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

    const aiResponse: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: generateResponse(text),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, aiResponse]);
    setIsTyping(false);
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    handleSend(prompt);
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="font-medium text-black">Noor AI</h1>
            <p className="text-xs text-gray-500">Your student finance assistant</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {messages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-black mb-2">Ask me anything</h2>
            <p className="text-sm text-gray-500 mb-6">
              I can help with banking, visa questions, taxes, and more.
            </p>

            {/* Quick Prompts */}
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_PROMPTS.map(prompt => (
                <button
                  key={prompt.id}
                  onClick={() => handleQuickPrompt(prompt.label)}
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
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-black text-white'
                        : 'bg-white border border-gray-200'
                    }`}
                  >
                    <div
                      className={`text-sm whitespace-pre-wrap ${
                        message.role === 'user' ? 'text-white' : 'text-gray-800'
                      }`}
                      dangerouslySetInnerHTML={{
                        __html: message.content
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\n/g, '<br />')
                      }}
                    />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Typing indicator */}
            {isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about banking, visa, taxes..."
            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300 transition-all"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isTyping}
            className="p-3 bg-black text-white rounded-xl disabled:opacity-50 transition-all hover:bg-gray-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
