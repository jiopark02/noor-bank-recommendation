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
  { id: 'extra', label: 'What do I do with extra $500?' },
  { id: 'flowchart', label: 'What\'s the money flowchart?' },
  { id: '401k', label: 'How does 401(k) matching work?' },
  { id: 'roth', label: 'Can I open a Roth IRA?' },
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

  extra_money: `**What to do with extra money** depends on where you are financially. Here's the order:

**1. High-interest debt first**
If you have credit card debt at 20%+ APR, pay that off. It's a guaranteed 20% return.

**2. Emergency fund**
Need at least 1 month of expenses as a buffer ($1,000-2,000 minimum).

**3. 401(k) employer match**
If your company matches, contribute enough to get the full match. It's free money!

**4. Build full emergency fund**
Work up to 3-6 months of expenses in a HYSA.

**5. Max Roth IRA**
$7,000/year of tax-free growth (if eligible).

**6. Max 401(k)**
$23,000/year limit.

**7. Taxable brokerage**
After maxing tax-advantaged accounts.

**Quick answer for $500:**
- Credit card debt? → Pay it off
- No emergency fund? → HYSA
- Have 401(k) match? → Increase contribution
- None of above? → Roth IRA or index funds

Check out the **Grow > Pro Tips** section for detailed flowcharts!`,

  '401k': `**401(k) for international students** - yes, you can participate!

**The basics:**
- Employer-sponsored retirement account
- 2024 limit: $23,000 (employee contribution)
- Pre-tax (Traditional) or after-tax (Roth 401k) options

**Why it matters:**
If your employer matches, that's **free money**. Example:
- Salary: $80,000
- Employer matches 50% of your contribution up to 6%
- You contribute 6% = $4,800
- Employer adds = $2,400
- That's a 50% instant return!

**For visa holders:**
- H-1B, L-1, OPT workers can all participate
- Money is yours even if you leave the US
- Can roll over to IRA when changing jobs

**Pro tips:**
1. Always contribute enough for full match
2. Understand your vesting schedule
3. If leaving job, roll over to IRA (don't cash out!)
4. Choose low-cost index funds if available

Visit **Grow > Pro Tips** for the 401(k) calculator!`,

  hsa: `**HSA (Health Savings Account)** - the ultimate tax-advantaged account!

**Triple tax benefit:**
1. Contributions are tax-deductible
2. Growth is tax-free
3. Withdrawals for medical expenses are tax-free

No other account has all three!

**Requirements:**
- Must have a High Deductible Health Plan (HDHP)
- 2024 deductible minimum: $1,600 individual, $3,200 family
- 2024 contribution limit: $4,150 individual

**Pro strategy (stealth IRA):**
1. Pay medical expenses out of pocket
2. Keep all receipts
3. Invest your HSA in index funds
4. Let it grow for decades
5. Withdraw anytime to "reimburse" yourself (no time limit!)

**Best HSA providers:**
- Fidelity (no fees, best for investing)
- Lively (modern interface)

**For visa holders:**
- Can contribute if you have qualifying HDHP
- Money stays with you if you leave US
- Great for building wealth long-term

Check **Grow > Pro Tips** for more HSA strategies!`,

  flowchart: `**The Money Flowchart** - follow this order!

This is the optimal sequence based on tax efficiency and guaranteed returns:

**Step 1: 401(k) up to employer match**
Free money > everything else

**Step 2: Pay off high-interest debt**
Credit cards at 20%? Pay them off.

**Step 3: Build 1-month emergency fund**
$1,000-2,000 as a buffer

**Step 4: Max HSA (if eligible)**
Triple tax advantage is unbeatable

**Step 5: Max Roth IRA**
$7,000/year of tax-free growth

**Step 6: Build 6-month emergency fund**
Now you're truly secure

**Step 7: Max 401(k) beyond match**
Up to $23,000 total

**Step 8: Taxable brokerage**
After all tax-advantaged space is full

**Quick reference:**
- Credit card debt? → Stop, pay it off first
- No emergency fund? → HYSA before investing
- Employer match available? → Don't leave free money
- HSA eligible? → Max it before Roth IRA

See the visual flowchart in **Grow > Pro Tips**!`,

  warning: `**Important warnings for international students:**

**Day trading can risk your visa**
Active trading as income may be considered unauthorized work on F-1. Stick to long-term investing.

**PFIC rules for foreign funds**
Never buy mutual funds or ETFs domiciled outside the US. Use US-domiciled funds only (VTI, VOO, etc.).

**Don't invest money you need soon**
If you need it in <5 years (tuition, visa fees), keep it in HYSA. Markets can drop 30%+.

**Pay credit card debt first**
Investing while carrying 20% APR debt = losing money. Pay it off completely first.

**Crypto is speculation**
Fine for 1-5% of portfolio. Not a retirement strategy.

**Keep liquid cash for emergencies**
Visa holders need more buffer ($5,000+) for unexpected immigration costs.

**FBAR requirement**
If foreign accounts exceed $10K total, file FBAR annually. Penalties are severe.

**Tax residency matters**
F-1 students (first 5 years) usually can't open Roth IRAs. Check before contributing.

More details in **Grow > Pro Tips > Warnings**!`,
};

const DEFAULT_RESPONSE = `I can help you with international student finance! Topics I know well:

**Savings & Investing:**
- HYSA (High-Yield Savings)
- Roth IRA eligibility
- 401(k) and employer matching
- HSA triple tax advantage
- Order of operations flowchart

**Banking & Credit:**
- Building credit score
- Credit card optimization
- Bank account setup without SSN

**Visa-specific:**
- Tax treaties by country
- FICA exemption rules
- FBAR/FATCA requirements
- Day trading restrictions

**Try asking:**
- "What should I do with extra $500?"
- "Can I open a Roth IRA on F-1?"
- "How does 401k matching work?"
- "What's the money flowchart?"

Or visit **Grow > Pro Tips** for 80+ detailed tips and calculators!`;

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

    // Check for extra money / what to do questions first
    if (lowerMessage.includes('extra') || lowerMessage.includes('what should i do with') || lowerMessage.includes('what do i do with') || lowerMessage.includes('spare money')) {
      return AI_RESPONSES.extra_money;
    }
    // Flowchart / order questions
    if (lowerMessage.includes('flowchart') || lowerMessage.includes('order') || lowerMessage.includes('priority') || lowerMessage.includes('what first') || lowerMessage.includes('where to start')) {
      return AI_RESPONSES.flowchart;
    }
    // Warning / caution questions
    if (lowerMessage.includes('warning') || lowerMessage.includes('mistake') || lowerMessage.includes('avoid') || lowerMessage.includes('careful') || lowerMessage.includes('risk')) {
      return AI_RESPONSES.warning;
    }
    // 401(k) specific
    if (lowerMessage.includes('401k') || lowerMessage.includes('401(k)') || lowerMessage.includes('employer match') || lowerMessage.includes('matching')) {
      return AI_RESPONSES['401k'];
    }
    // HSA specific
    if (lowerMessage.includes('hsa') || lowerMessage.includes('health savings') || lowerMessage.includes('triple tax')) {
      return AI_RESPONSES.hsa;
    }
    // Credit
    if (lowerMessage.includes('credit') || lowerMessage.includes('credit card') || lowerMessage.includes('build credit')) {
      return AI_RESPONSES.credit;
    }
    // SSN
    if (lowerMessage.includes('ssn') || lowerMessage.includes('social security')) {
      return AI_RESPONSES.ssn;
    }
    // Tax
    if (lowerMessage.includes('tax') || lowerMessage.includes('1040') || lowerMessage.includes('8843') || lowerMessage.includes('fbar') || lowerMessage.includes('treaty')) {
      return AI_RESPONSES.tax;
    }
    // OPT/CPT
    if (lowerMessage.includes('opt') || lowerMessage.includes('cpt') || lowerMessage.includes('work authorization')) {
      return AI_RESPONSES.opt;
    }
    // HYSA
    if (lowerMessage.includes('hysa') || lowerMessage.includes('high yield') || lowerMessage.includes('high-yield') || lowerMessage.includes('savings account')) {
      return AI_RESPONSES.hysa;
    }
    // Roth IRA
    if (lowerMessage.includes('roth') || lowerMessage.includes('ira') || lowerMessage.includes('retirement')) {
      return AI_RESPONSES.roth;
    }
    // General savings
    if (lowerMessage.includes('sav') || lowerMessage.includes('emergency fund')) {
      return AI_RESPONSES.savings;
    }
    // General investing
    if (lowerMessage.includes('invest') || lowerMessage.includes('stock') || lowerMessage.includes('index fund') || lowerMessage.includes('etf') || lowerMessage.includes('brokerage')) {
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
