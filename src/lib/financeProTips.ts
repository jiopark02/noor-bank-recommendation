// Comprehensive Finance Pro Tips for International Students
// Research compiled from Reddit r/personalfinance, r/financialindependence,
// Investopedia, NerdWallet, Bogleheads wiki, and international student blogs

export type TipCategory =
  | 'hysa'
  | 'roth_ira'
  | '401k'
  | 'hsa'
  | 'credit_cards'
  | 'tax'
  | 'investing'
  | 'emergency_fund'
  | 'order_of_operations'
  | 'warnings';

export type UserLevel = 'beginner' | 'intermediate' | 'advanced';
export type StudentLevel = 'undergrad' | 'masters' | 'phd' | 'opt' | 'h1b' | 'working';

export interface ProTip {
  id: string;
  category: TipCategory;
  headline: string;
  explanation: string;
  whyItMatters: string;
  actionLabel?: string;
  actionLink?: string;
  isWarning?: boolean;
  visaRelevant?: boolean;
  userLevel: UserLevel; // beginner, intermediate, advanced
}

// Get user finance level based on their profile
export function getUserFinanceLevel(profile: {
  studentLevel?: string;
  academicLevel?: string;
  year?: number;
  visaStatus?: string;
}): UserLevel {
  const { studentLevel, academicLevel, year, visaStatus } = profile;

  // OPT, H-1B, or working = advanced
  if (visaStatus === 'H-1B' || visaStatus === 'OPT' || visaStatus === 'F-1 OPT') {
    return 'advanced';
  }

  // Masters, PhD, Postdoc = advanced
  if (academicLevel === "Master's" || academicLevel === 'PhD' || academicLevel === 'Postdoc') {
    return 'advanced';
  }

  // Undergrad 4th year or later = intermediate
  if (studentLevel === 'undergrad' || academicLevel === "Bachelor's") {
    if (year && year >= 4) {
      return 'intermediate';
    }
    // 1st-3rd year undergrad = beginner
    return 'beginner';
  }

  // Default to beginner
  return 'beginner';
}

// Smart messaging by year/level
export function getSmartMessage(profile: {
  studentLevel?: string;
  academicLevel?: string;
  year?: number;
  visaStatus?: string;
}): { title: string; subtitle: string } {
  const { academicLevel, year, visaStatus } = profile;

  if (visaStatus === 'H-1B') {
    return {
      title: "Time to optimize.",
      subtitle: "You've got income, benefits, and opportunities. Let's make your money work harder.",
    };
  }

  if (visaStatus === 'OPT' || visaStatus === 'F-1 OPT') {
    return {
      title: "Welcome to the real world.",
      subtitle: "First paycheck feels good. Let's set up your finances right from day one.",
    };
  }

  if (academicLevel === "Master's" || academicLevel === 'PhD') {
    return {
      title: "Grad school finances.",
      subtitle: "Stipends, side gigs, and planning ahead. You've got more options than you think.",
    };
  }

  // Undergrad by year
  if (year === 1) {
    return {
      title: "Welcome!",
      subtitle: "Let's build strong foundations. Start with an emergency fund and learn the basics.",
    };
  }

  if (year === 2) {
    return {
      title: "You're getting the hang of it.",
      subtitle: "Keep that HYSA growing. Consider starting to build credit too.",
    };
  }

  if (year === 3) {
    return {
      title: "Almost there!",
      subtitle: "Start learning about what comes after graduation. The real world is closer than you think.",
    };
  }

  if (year === 4) {
    return {
      title: "Big year ahead!",
      subtitle: "Let's prep your finances for the real world. Jobs, offers, and new opportunities await.",
    };
  }

  return {
    title: "Let's grow your money.",
    subtitle: "Smart savings and investing for international students. No experience needed.",
  };
}

// ============================================
// HYSA TIPS (All Levels)
// ============================================
export const HYSA_TIPS: ProTip[] = [
  {
    id: 'hysa_1',
    category: 'hysa',
    headline: "Keep 1 month expenses in checking, rest in HYSA",
    explanation: "Your checking account should have just enough for bills and daily spending. Everything else should be earning 4%+ in a high-yield savings account. Money sitting in checking at 0.01% is money you're losing.",
    whyItMatters: "Even $5,000 in a HYSA earns ~$200/year. Same money in checking earns 50 cents. That's free money for moving some numbers around.",
    userLevel: 'beginner',
  },
  {
    id: 'hysa_2',
    category: 'hysa',
    headline: "Current best rates: Marcus 4.5%, Ally 4.2%, SoFi 4.3%",
    explanation: "Marcus by Goldman Sachs leads with 4.5% APY, no minimums or fees. Ally is great for savings buckets. SoFi needs direct deposit for best rate. All are F-1 friendly.",
    whyItMatters: "Rates change often but these are consistently top tier. Don't chase every 0.1% difference - your time is worth more.",
    userLevel: 'beginner',
  },
  {
    id: 'hysa_3',
    category: 'hysa',
    headline: "SSN needed for some, but not all",
    explanation: "Marcus and Ally typically want SSN. Discover accepts ITIN. Some online banks accept passport + visa documents. Call before giving up - many have manual review processes.",
    whyItMatters: "Don't assume you can't open an account without SSN. Many international students get approved with alternative documentation.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'hysa_4',
    category: 'hysa',
    headline: "Interest over $10 = 1099-INT tax form",
    explanation: "You'll receive a 1099-INT form for interest earned over $10. This is US-source income and must be reported on your tax return, even as a non-resident.",
    whyItMatters: "Factor taxes into your real returns. 4.5% APY is really ~3.5% after federal tax if you're in the 22% bracket. Still much better than 0.01%.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'hysa_5',
    category: 'hysa',
    headline: "Sign-up bonuses can add $200+ extra",
    explanation: "Chase offers $300 checking + $150 savings with direct deposit. SoFi has periodic $300 bonuses. These stack with regular interest earnings.",
    whyItMatters: "Free $200-450 for opening accounts you need anyway. Just read the fine print for minimum deposit/direct deposit requirements.",
    userLevel: 'beginner',
  },
  {
    id: 'hysa_6',
    category: 'hysa',
    headline: "No penalty for withdrawal - it's not a CD",
    explanation: "Unlike CDs (Certificates of Deposit), HYSA withdrawals are free and instant. You can access your money anytime with no penalties or waiting periods.",
    whyItMatters: "Some people avoid HYSA thinking money is locked. It's not. Keep your emergency fund here for instant access AND good returns.",
    userLevel: 'beginner',
  },
  {
    id: 'hysa_7',
    category: 'hysa',
    headline: "Use savings buckets for mental accounting",
    explanation: "Ally and Capital One let you create separate 'buckets' within one account. Label them: Emergency, Travel, Tuition, Car Fund, etc.",
    whyItMatters: "Seeing '$3,000 emergency fund' vs just '$3,000' makes you less likely to dip into it. Psychology matters.",
    userLevel: 'beginner',
  },
];

// ============================================
// EMERGENCY FUND TIPS (All Levels)
// ============================================
export const EMERGENCY_FUND_TIPS: ProTip[] = [
  {
    id: 'ef_1',
    category: 'emergency_fund',
    headline: "International students: aim for 6 months, not 3",
    explanation: "Visa holders face unique risks: job loss means 60-day grace period, deportation risk, and limited job options due to sponsorship needs. Standard 3-month advice doesn't account for this.",
    whyItMatters: "6 months of expenses gives you time to find a sponsor, handle visa emergencies, or afford an unexpected flight home.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'ef_2',
    category: 'emergency_fund',
    headline: "This is insurance, not investment",
    explanation: "Your emergency fund should NOT be invested in stocks. Keep it in HYSA where it's safe and accessible. A 30% market drop is exactly when you might need this money.",
    whyItMatters: "Emergencies don't wait for the market to recover. Stability > returns for this money.",
    userLevel: 'beginner',
  },
  {
    id: 'ef_3',
    category: 'emergency_fund',
    headline: "Include one-way flight home in your calculation",
    explanation: "Worst case scenario: visa issues force return. Last-minute international one-way tickets can be $1,500-3,000. Factor this into your emergency fund target.",
    whyItMatters: "Having 'go home money' provides peace of mind. You're never truly stuck.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'ef_4',
    category: 'emergency_fund',
    headline: "Calculate based on expenses, not income",
    explanation: "If you spend $3,000/month, 6 months = $18,000. Your income doesn't matter; your burn rate does. Include rent, food, insurance, phone, subscriptions.",
    whyItMatters: "High income with low expenses = smaller fund needed. Low income with high expenses = bigger fund needed.",
    userLevel: 'beginner',
  },
  {
    id: 'ef_5',
    category: 'emergency_fund',
    headline: "Use it when appropriate - that's what it's for",
    explanation: "Job loss, medical emergency, car repair, visa fee emergency = yes. Vacation, new phone, 'investment opportunity', crypto dip = no.",
    whyItMatters: "Some people hoard it too much, others raid it for wants. Know the difference between emergencies and wants.",
    userLevel: 'beginner',
  },
  {
    id: 'ef_6',
    category: 'emergency_fund',
    headline: "Replenish immediately after using",
    explanation: "If you use $2,000 from emergency fund, prioritize rebuilding it before resuming regular investing or discretionary spending.",
    whyItMatters: "The next emergency could happen tomorrow. Don't stay financially exposed.",
    userLevel: 'beginner',
  },
];

// ============================================
// CREDIT CARD TIPS (All Levels)
// ============================================
export const CREDIT_CARD_TIPS: ProTip[] = [
  {
    id: 'cc_1',
    category: 'credit_cards',
    headline: "Discover it Student - easiest first card for F-1",
    explanation: "Discover is known for approving international students with no credit history. The Student version needs no SSN to apply - just ITIN or passport. Plus they match all cashback first year.",
    whyItMatters: "Building credit from zero is hard. Discover gives you a foot in the door when others won't.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'cc_2',
    category: 'credit_cards',
    headline: "Never use more than 30% of your limit",
    explanation: "Credit utilization (balance ÷ limit) is a major score factor. If your limit is $1,000, keep balance under $300. Under 10% is even better for your score.",
    whyItMatters: "High utilization can drop your score 50+ points instantly. It recovers when you pay down, but why hurt yourself?",
    userLevel: 'beginner',
  },
  {
    id: 'cc_3',
    category: 'credit_cards',
    headline: "Pay FULL balance every month - no exceptions",
    explanation: "Pay the statement balance by due date. Not minimum payment (that's a trap). Not current balance (unnecessary). Statement balance = no interest charged.",
    whyItMatters: "Credit card interest is 20-30% APR. That $100 purchase becomes $130 if you carry it. Never pay interest on a credit card.",
    userLevel: 'beginner',
  },
  {
    id: 'cc_4',
    category: 'credit_cards',
    headline: "Don't close old cards - hurts credit age",
    explanation: "Average age of accounts matters for your score. Closing your oldest card can drop your average age significantly. Keep them open, even if unused.",
    whyItMatters: "A 5-year credit history looks much better than 1-year. Sock drawer your old card but don't close it.",
    userLevel: 'beginner',
  },
  {
    id: 'cc_5',
    category: 'credit_cards',
    headline: "Check Credit Karma for free weekly updates",
    explanation: "Credit Karma shows your score from TransUnion and Equifax for free. It updates weekly. You'll see what affects your score and catch errors early.",
    whyItMatters: "Knowledge is power. Watching your score grow is motivating. Catching fraud early saves headaches.",
    userLevel: 'beginner',
  },
  {
    id: 'cc_6',
    category: 'credit_cards',
    headline: "Sign-up bonuses are the real value",
    explanation: "A $200 bonus for spending $500 in 3 months = 40% return. Normal 2% cashback on that spend = $10. Strategic bonuses >>> everyday rewards.",
    whyItMatters: "One or two good sign-up bonuses per year can net $500+ for spending you'd do anyway.",
    userLevel: 'intermediate',
  },
  {
    id: 'cc_7',
    category: 'credit_cards',
    headline: "Product change instead of cancel",
    explanation: "Want to ditch an annual fee card? Ask to 'product change' to a no-fee version. Chase Sapphire → Freedom Unlimited. Keeps your credit history alive.",
    whyItMatters: "Closing cards hurts credit age and total available credit. Downgrading avoids both problems.",
    userLevel: 'intermediate',
  },
  {
    id: 'cc_8',
    category: 'credit_cards',
    headline: "Match cards to spending categories",
    explanation: "Use Amex Gold for groceries (4x), Chase Sapphire for dining (3x), Amazon card for Amazon (5%), and a 2% card for everything else.",
    whyItMatters: "Going from 1% to 3% average return on $2,000/month spend = extra $480/year. Real money.",
    userLevel: 'advanced',
  },
];

// ============================================
// ROTH IRA TIPS (Intermediate+)
// ============================================
export const ROTH_IRA_TIPS: ProTip[] = [
  {
    id: 'roth_1',
    category: 'roth_ira',
    headline: "OPT/H-1B = likely eligible. Start ASAP.",
    explanation: "If you're working on OPT (post 5 years in US) or H-1B, you probably pass the Substantial Presence Test and can contribute to a Roth IRA. Don't wait.",
    whyItMatters: "Every year you delay costs you decades of tax-free compound growth. Starting at 25 vs 30 = potentially $100K+ difference at retirement.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'roth_2',
    category: 'roth_ira',
    headline: "2024 limit: $7,000/year - try to max it",
    explanation: "The annual limit is $7,000 (or $8,000 if over 50). Contribute as much as you can. Even $200/month = $2,400/year = significant long-term wealth.",
    whyItMatters: "You can't go back and contribute for previous years. The limit is 'use it or lose it' annually.",
    userLevel: 'intermediate',
  },
  {
    id: 'roth_3',
    category: 'roth_ira',
    headline: "Roth IRA + 401(k) = yes, you can do both",
    explanation: "These aren't either/or. Max your 401(k) match first, then max Roth IRA, then go back to 401(k). Different accounts, different limits, complementary benefits.",
    whyItMatters: "Together they let you save $30,000+ tax-advantaged per year. Use all the tools available.",
    userLevel: 'intermediate',
  },
  {
    id: 'roth_4',
    category: 'roth_ira',
    headline: "Fidelity, Schwab = $0 fees. Best choices.",
    explanation: "Fidelity has zero expense ratio index funds (FZROX, FZILX). Schwab has great research tools. Both have no account fees or minimums.",
    whyItMatters: "Vanguard is great too, but Fidelity/Schwab have better apps and fractional shares. All three beat expensive managed accounts.",
    userLevel: 'intermediate',
  },
  {
    id: 'roth_5',
    category: 'roth_ira',
    headline: "Target Date Fund = set it and forget it",
    explanation: "Vanguard Target Retirement 2060 or Fidelity Freedom Index 2060 are perfectly good choices. Automatically diversified and rebalanced. ~0.10-0.15% expense ratio.",
    whyItMatters: "Don't let analysis paralysis stop you. A target date fund beats not investing at all. You can optimize later.",
    userLevel: 'intermediate',
  },
  {
    id: 'roth_6',
    category: 'roth_ira',
    headline: "April 15 deadline for previous year",
    explanation: "You can contribute for 2024 from Jan 1, 2024 to April 15, 2025. Use this to catch up if you missed maxing out during the year.",
    whyItMatters: "If you get a tax refund or bonus in February, you can still contribute for last year. Extra time to max out.",
    userLevel: 'intermediate',
  },
  {
    id: 'roth_7',
    category: 'roth_ira',
    headline: "Can withdraw contributions (not gains) anytime",
    explanation: "Roth IRA contributions (the money you put in, not the growth) can be withdrawn tax and penalty-free anytime. It's not as locked up as people think.",
    whyItMatters: "This is a psychological safety net. You're more likely to contribute knowing you have emergency access to principal.",
    userLevel: 'intermediate',
  },
  {
    id: 'roth_8',
    category: 'roth_ira',
    headline: "Backdoor Roth for high earners",
    explanation: "If income exceeds Roth limits (~$161K single), contribute to Traditional IRA then immediately convert to Roth. Legal loophole used by millions.",
    whyItMatters: "Tech workers on H-1B often exceed income limits quickly. Backdoor Roth keeps you in the game.",
    userLevel: 'advanced',
  },
];

// ============================================
// 401(K) TIPS (Intermediate+)
// ============================================
export const FOUR01K_TIPS: ProTip[] = [
  {
    id: '401k_1',
    category: '401k',
    headline: "Company match = FREE MONEY. Always get 100%.",
    explanation: "If employer matches 50% up to 6% of salary, contribute at least 6%. On $80K salary, that's $2,400 free per year. Literally free money.",
    whyItMatters: "Not contributing enough for full match = leaving part of your salary on the table. It's an instant 50-100% return.",
    userLevel: 'intermediate',
  },
  {
    id: '401k_2',
    category: '401k',
    headline: "Example: 3% match means contribute at least 3%",
    explanation: "If your company matches 100% up to 3%, you contribute 3%, they contribute 3%. That's 6% total going into retirement for 3% of your paycheck.",
    whyItMatters: "Understand your specific match formula. HR can explain it. It's usually in your benefits package.",
    userLevel: 'intermediate',
  },
  {
    id: '401k_3',
    category: '401k',
    headline: "Not contributing to match = losing salary",
    explanation: "A 3% match on $100K salary = $3,000/year you're not getting. Over 10 years with 7% growth, that's $41,000+ lost.",
    whyItMatters: "Would you throw away $3,000 cash? That's what skipping the match does every year.",
    userLevel: 'intermediate',
  },
  {
    id: '401k_4',
    category: '401k',
    headline: "Traditional vs Roth 401(k): low taxes now = Roth",
    explanation: "Traditional: tax deduction now, pay taxes at withdrawal. Roth: pay taxes now, withdrawals are tax-free. If you're in a low tax bracket now, Roth often wins.",
    whyItMatters: "Young international workers usually expect higher future income. Roth locks in today's lower tax rate.",
    userLevel: 'intermediate',
  },
  {
    id: '401k_5',
    category: '401k',
    headline: "Check vesting schedule - matches may take 3-4 years",
    explanation: "Employer matches often 'vest' over time. 25% per year means after 2 years, you only keep 50% if you leave. After 4 years, it's all yours.",
    whyItMatters: "Job hopping is common on visas. Know what you'll actually keep if you leave early.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: '401k_6',
    category: '401k',
    headline: "Changing jobs? Rollover to IRA, don't cash out",
    explanation: "When you leave a job, roll your 401(k) to an IRA or new employer's plan. Cashing out = massive tax penalty (30%+). Never cash out.",
    whyItMatters: "International workers change jobs often. Each time, protect your retirement savings with a proper rollover.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: '401k_7',
    category: '401k',
    headline: "Mega backdoor Roth: ask HR about after-tax contributions",
    explanation: "Some 401(k) plans allow after-tax contributions above the $23K limit, then in-plan conversion to Roth. This can add $40K+ extra per year to Roth.",
    whyItMatters: "Major tech companies (Google, Meta, Amazon) often offer this. It's the ultimate tax-advantaged savings hack.",
    userLevel: 'advanced',
  },
];

// ============================================
// HSA TIPS (Advanced)
// ============================================
export const HSA_TIPS: ProTip[] = [
  {
    id: 'hsa_1',
    category: 'hsa',
    headline: "Triple tax advantage: the best account type",
    explanation: "1) Contributions are tax-deductible, 2) Growth is tax-free, 3) Withdrawals for medical are tax-free. No other account has all three benefits.",
    whyItMatters: "If you have access to an HSA, it beats Roth IRA on tax benefits. Prioritize it in your order of operations.",
    userLevel: 'advanced',
  },
  {
    id: 'hsa_2',
    category: 'hsa',
    headline: "Need HDHP (High Deductible Health Plan) to contribute",
    explanation: "2024 minimum deductible is $1,600 (individual) or $3,200 (family). Check if your employer plan qualifies. Many do.",
    whyItMatters: "Don't assume you can't. Even some student health insurance plans qualify. Check before missing out.",
    userLevel: 'advanced',
  },
  {
    id: 'hsa_3',
    category: 'hsa',
    headline: "2024 limit: $4,150 individual, $8,300 family",
    explanation: "You can contribute up to these limits if you have an HDHP all year. Prorated if you only qualify for part of the year.",
    whyItMatters: "Max it out if possible. After ~$1,000 cash buffer for expenses, invest the rest in index funds.",
    userLevel: 'advanced',
  },
  {
    id: 'hsa_4',
    category: 'hsa',
    headline: "Can invest after $1,000 balance",
    explanation: "Most HSAs let you invest once you hit a threshold (often $1,000). Don't leave it sitting in cash earning 0.1%.",
    whyItMatters: "Cash HSA at 0% vs invested HSA growing 7%/year = massive difference over 20+ years.",
    userLevel: 'advanced',
  },
  {
    id: 'hsa_5',
    category: 'hsa',
    headline: "Keep receipts forever - reimburse yourself later",
    explanation: "Pay medical expenses out of pocket now, keep receipts, invest HSA money. Reimburse yourself years or decades later. No time limit on reimbursement.",
    whyItMatters: "This is the 'stealth retirement account' strategy. Decades of tax-free growth, then tax-free withdrawals.",
    userLevel: 'advanced',
  },
  {
    id: 'hsa_6',
    category: 'hsa',
    headline: "Secret: best retirement account if maxed",
    explanation: "After age 65, HSA can be used for anything (not just medical) - just pay income tax like Traditional IRA. But medical withdrawals stay tax-free forever.",
    whyItMatters: "It's a super-powered retirement account that most people don't understand. You're ahead of the curve.",
    userLevel: 'advanced',
  },
];

// ============================================
// TAX TIPS (Mixed Levels)
// ============================================
export const TAX_TIPS: ProTip[] = [
  {
    id: 'tax_1',
    category: 'tax',
    headline: "F-1 first 5 years: Non-Resident = 1040-NR",
    explanation: "F-1 students are exempt from the Substantial Presence Test for 5 calendar years. You file 1040-NR (non-resident) not regular 1040.",
    whyItMatters: "Using wrong form = wrong tax calculation = IRS issues. Non-residents also can't use TurboTax - use Sprintax instead.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'tax_2',
    category: 'tax',
    headline: "FICA exempt while F-1 student (no SS/Medicare tax)",
    explanation: "F-1/J-1 students are exempt from Social Security (6.2%) and Medicare (1.45%) taxes for first 5 years. That's 7.65% of income you keep.",
    whyItMatters: "If your employer incorrectly withholds FICA, you can get it refunded. Check your paystub. That's real money.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'tax_3',
    category: 'tax',
    headline: "OPT work starts = FICA may be required",
    explanation: "Once you transition from student to full-time OPT worker (after 5 years in US), you may become a resident for tax purposes and owe FICA.",
    whyItMatters: "Know when your status changes. Your take-home pay will decrease when FICA kicks in.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'tax_4',
    category: 'tax',
    headline: "Check tax treaty: Korea = $2,000, China/India = $5,000 exempt",
    explanation: "Many countries have tax treaties with the US that exempt student income. Korea: $2,000. China: $5,000. India: $5,000. Germany: $9,000.",
    whyItMatters: "This is free money many students miss. Treaty benefits are in addition to standard deductions. File the treaty form!",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'tax_5',
    category: 'tax',
    headline: "FBAR required if foreign accounts > $10,000 total",
    explanation: "If your foreign bank accounts exceed $10,000 total at ANY point during the year, you must file FBAR (FinCEN 114). It's separate from your tax return.",
    whyItMatters: "Penalties are severe ($10K+ per violation). If you have money in home country banks, you probably need to file this.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'tax_6',
    category: 'tax',
    headline: "Use Sprintax or Glacier for easy NRA filing",
    explanation: "TurboTax doesn't support non-resident returns. Sprintax is designed for F-1/J-1 students. Many schools offer free access. Glacier is another option.",
    whyItMatters: "Using wrong software = wrong filing = IRS audit risk. Use the right tool from the start.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'tax_7',
    category: 'tax',
    headline: "State taxes vary - some states have 0%",
    explanation: "Texas, Florida, Washington, Nevada = no state income tax. California = up to 13.3%. New York = up to 10.9%. This matters for job decisions.",
    whyItMatters: "$100K in Texas keeps ~$7K more than California after state tax. Consider this when comparing job offers.",
    userLevel: 'intermediate',
  },
  {
    id: 'tax_8',
    category: 'tax',
    headline: "Form 8843 is mandatory even with zero income",
    explanation: "Every F-1/J-1 student must file Form 8843 annually, even if you earned nothing. It's a statement of non-residence. Takes 5 minutes.",
    whyItMatters: "Not filing can complicate future visa applications and green card processes. Just do it every year.",
    visaRelevant: true,
    userLevel: 'beginner',
  },
];

// ============================================
// INVESTING TIPS (Advanced)
// ============================================
export const INVESTING_TIPS: ProTip[] = [
  {
    id: 'inv_1',
    category: 'investing',
    headline: "Three-fund portfolio: US stocks, International, Bonds",
    explanation: "VTI (US total market) + VXUS (International) + BND (Bonds). Classic Bogleheads approach. Adjust ratio based on age and risk tolerance (more stocks when young).",
    whyItMatters: "Simple, cheap, diversified. This strategy outperforms 80% of actively managed funds over 20 years. Don't overcomplicate it.",
    userLevel: 'advanced',
  },
  {
    id: 'inv_2',
    category: 'investing',
    headline: "Keep expense ratios under 0.2%",
    explanation: "Expense ratio is the annual fee funds charge. VTI is 0.03%. Some managed funds are 1%+. That 1% difference = $100K+ over 30 years on a $100K portfolio.",
    whyItMatters: "Fees are the one thing you can control. Low-cost index funds beat expensive active funds most of the time.",
    userLevel: 'advanced',
  },
  {
    id: 'inv_3',
    category: 'investing',
    headline: "Dollar cost average - don't try to time the market",
    explanation: "Invest the same amount every month regardless of market conditions. You buy more shares when cheap, fewer when expensive. Removes emotion from investing.",
    whyItMatters: "Nobody can consistently time the market. Not even professionals. Automatic monthly investing is the winning strategy.",
    userLevel: 'intermediate',
  },
  {
    id: 'inv_4',
    category: 'investing',
    headline: "Index funds beat most active managers",
    explanation: "Over 15 years, ~90% of actively managed funds underperform their index benchmark. Most 'expert' stock pickers lose to simple index funds.",
    whyItMatters: "Don't pay expensive managers to underperform. Just buy the whole market with VTI or VOO and chill.",
    userLevel: 'advanced',
  },
  {
    id: 'inv_5',
    category: 'investing',
    headline: "Don't invest money you need in under 5 years",
    explanation: "Stock market can drop 30-50% and take years to recover. Money for tuition, visa fees, car purchase, or wedding should stay in HYSA.",
    whyItMatters: "Emergencies and big purchases don't wait for market recovery. Keep short-term money safe.",
    userLevel: 'intermediate',
  },
  {
    id: 'inv_6',
    category: 'investing',
    headline: "PFIC rules make foreign funds complicated - stick to US",
    explanation: "Holding mutual funds or ETFs domiciled outside US triggers PFIC rules: punitive taxation, often 40%+ effective rate. Nightmare paperwork.",
    whyItMatters: "Never invest in your home country's funds while US tax resident. Use US-domiciled funds (VTI, VOO, VXUS) only.",
    visaRelevant: true,
    userLevel: 'advanced',
  },
];

// ============================================
// ORDER OF OPERATIONS (Flowchart)
// ============================================
export const ORDER_OF_OPERATIONS: ProTip[] = [
  {
    id: 'order_1',
    category: 'order_of_operations',
    headline: "Step 1: 401(k) up to employer match",
    explanation: "If employer matches 50% of 6%, contribute 6%. This is an instant 50% return. Nothing beats free money. Do this first, always.",
    whyItMatters: "Even if you have debt, the guaranteed return of employer match usually beats paying off debt. It's FREE MONEY.",
    userLevel: 'intermediate',
  },
  {
    id: 'order_2',
    category: 'order_of_operations',
    headline: "Step 2: Pay off high-interest debt (>7%)",
    explanation: "Credit card at 20% APR? Pay it off. That's a guaranteed 20% return. Student loans and car loans under 7% can wait.",
    whyItMatters: "Investing while carrying 20% debt is like taking out a 20% loan to invest. The math doesn't work.",
    userLevel: 'beginner',
  },
  {
    id: 'order_3',
    category: 'order_of_operations',
    headline: "Step 3: Emergency fund (1 month to start)",
    explanation: "Get $1,000-2,000 as starter emergency fund. This prevents you from going back into debt when a surprise hits.",
    whyItMatters: "A small buffer while you tackle other goals keeps you from falling backward.",
    userLevel: 'beginner',
  },
  {
    id: 'order_4',
    category: 'order_of_operations',
    headline: "Step 4: Max HSA (if eligible)",
    explanation: "HSA beats Roth IRA on tax benefits due to triple tax advantage. $4,150 limit (2024) for individuals. Max it if you have HDHP.",
    whyItMatters: "Triple tax advantage is unique to HSA. If you have access, use it before other retirement accounts.",
    userLevel: 'advanced',
  },
  {
    id: 'order_5',
    category: 'order_of_operations',
    headline: "Step 5: Max Roth IRA ($7,000)",
    explanation: "$7,000 limit (2024). Tax-free growth for decades. Can withdraw contributions if needed. Young + lower tax bracket = Roth wins.",
    whyItMatters: "After HSA, Roth IRA is the best tax-advantaged growth vehicle for people expecting higher future income.",
    userLevel: 'intermediate',
  },
  {
    id: 'order_6',
    category: 'order_of_operations',
    headline: "Step 6: Emergency fund (6 months)",
    explanation: "Now that high-interest debt is gone and retirement is started, build full 6-month emergency fund. Visa holders: aim for 6-12 months.",
    whyItMatters: "Full buffer before aggressive investing protects your financial stability. Especially important on visa.",
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'order_7',
    category: 'order_of_operations',
    headline: "Step 7: Max 401(k) ($23,000)",
    explanation: "$23,000 limit (2024) for employee contributions. Tax-deferred growth. After getting the match, come back to max it fully.",
    whyItMatters: "Beyond the match, 401(k) is still excellent tax-advantaged space. Fill it up before taxable accounts.",
    userLevel: 'advanced',
  },
  {
    id: 'order_8',
    category: 'order_of_operations',
    headline: "Step 8: Taxable brokerage",
    explanation: "After maxing all tax-advantaged accounts, invest in regular brokerage. No limits, but no tax benefits either. This is where wealth really accumulates.",
    whyItMatters: "If you're here, you're doing amazing. Most people never max all their tax-advantaged space.",
    userLevel: 'advanced',
  },
];

// ============================================
// WARNINGS
// ============================================
export const WARNINGS: ProTip[] = [
  {
    id: 'warn_1',
    category: 'warnings',
    headline: "Day trading can jeopardize your visa status",
    explanation: "Active trading as primary income source may be considered 'unauthorized work' on F-1 visa. ICE has flagged students for this. Passive buy-and-hold investing is fine.",
    whyItMatters: "Don't risk deportation for day trading. Long-term index fund investing is both safer for your visa AND your returns.",
    isWarning: true,
    visaRelevant: true,
    userLevel: 'intermediate',
  },
  {
    id: 'warn_2',
    category: 'warnings',
    headline: "PFIC rules: don't buy foreign ETFs/mutual funds",
    explanation: "Holding funds domiciled outside US triggers PFIC taxation: punitive rates (often 40%+), complex Form 8621, nightmare paperwork every year.",
    whyItMatters: "Selling your Indian/Chinese/European mutual funds before becoming US tax resident. Don't buy new ones while here.",
    isWarning: true,
    visaRelevant: true,
    userLevel: 'advanced',
  },
  {
    id: 'warn_3',
    category: 'warnings',
    headline: "Pay credit card debt before investing",
    explanation: "20%+ APR debt grows faster than any investment returns. You're guaranteed to lose money investing while carrying credit card debt.",
    whyItMatters: "Pay off credit cards completely before putting a single dollar into the stock market. No exceptions.",
    isWarning: true,
    userLevel: 'beginner',
  },
  {
    id: 'warn_4',
    category: 'warnings',
    headline: "Don't invest your emergency fund",
    explanation: "Emergency fund goes in HYSA, not stocks. A 30% market crash is exactly when you might need that money (job loss, etc.).",
    whyItMatters: "Safety and accessibility trump returns for emergency money. Accept lower returns for peace of mind.",
    isWarning: true,
    userLevel: 'beginner',
  },
  {
    id: 'warn_5',
    category: 'warnings',
    headline: "Crypto is speculation, not investment",
    explanation: "Bitcoin, meme coins, NFTs = gambling with extra steps. Fine for fun money (1-5% of portfolio max). Not a core investment strategy.",
    whyItMatters: "Many students lost significant money in crypto crashes. Don't bet your future on speculation.",
    isWarning: true,
    userLevel: 'beginner',
  },
  {
    id: 'warn_6',
    category: 'warnings',
    headline: "If it sounds too good to be true, it's a scam",
    explanation: "Anything promising 20%+ guaranteed returns is a scam. Average stock market return is ~10% before inflation. Period.",
    whyItMatters: "International students have been targeted by Ponzi schemes and crypto scams. If someone 'guarantees' returns, run.",
    isWarning: true,
    visaRelevant: true,
    userLevel: 'beginner',
  },
  {
    id: 'warn_7',
    category: 'warnings',
    headline: "Options trading is not for beginners",
    explanation: "You can lose more than you invest with options. 90%+ of retail options traders lose money. The WSB 'get rich quick' posts are survivorship bias.",
    whyItMatters: "Index funds are boring but they work. Options are exciting and they'll probably drain your account.",
    isWarning: true,
    userLevel: 'intermediate',
  },
  {
    id: 'warn_8',
    category: 'warnings',
    headline: "Keep liquid cash for visa emergencies",
    explanation: "Premium processing ($2,805), expedited appointments, legal fees, emergency flights - visa situations can require fast access to $2,000-5,000.",
    whyItMatters: "Immigration situations move fast. Having cash available can make the difference. Don't lock it all up.",
    isWarning: true,
    visaRelevant: true,
    userLevel: 'beginner',
  },
];

// ============================================
// ALL TIPS COMBINED
// ============================================
export const ALL_TIPS: ProTip[] = [
  ...HYSA_TIPS,
  ...ROTH_IRA_TIPS,
  ...FOUR01K_TIPS,
  ...HSA_TIPS,
  ...CREDIT_CARD_TIPS,
  ...TAX_TIPS,
  ...INVESTING_TIPS,
  ...EMERGENCY_FUND_TIPS,
  ...ORDER_OF_OPERATIONS,
  ...WARNINGS,
];

// ============================================
// CALCULATORS
// ============================================

// 401(k) Match Calculator
export function calculate401kMatchLoss(
  salary: number,
  matchPercent: number, // e.g., 50 for 50% match
  maxMatchContribution: number, // e.g., 6 for 6% of salary
  currentContribution: number, // e.g., 3 for 3%
  years: number = 30
): { annualLoss: number; totalLoss: number; withGrowth: number } {
  const maxMatchAmount = (salary * (maxMatchContribution / 100)) * (matchPercent / 100);
  const currentMatchAmount = (salary * (Math.min(currentContribution, maxMatchContribution) / 100)) * (matchPercent / 100);
  const annualLoss = Math.max(0, maxMatchAmount - currentMatchAmount);
  const totalLoss = annualLoss * years;

  // With 7% growth compounded
  let withGrowth = 0;
  for (let i = 0; i < years; i++) {
    withGrowth = (withGrowth + annualLoss) * 1.07;
  }

  return { annualLoss: Math.round(annualLoss), totalLoss: Math.round(totalLoss), withGrowth: Math.round(withGrowth) };
}

// Roth IRA Compound Growth Calculator
export function calculateRothGrowth(
  annualContribution: number,
  currentAge: number,
  retirementAge: number = 65,
  returnRate: number = 0.07
): { finalBalance: number; totalContributed: number; totalGrowth: number } {
  const years = Math.max(0, retirementAge - currentAge);
  let balance = 0;
  const totalContributed = annualContribution * years;

  for (let i = 0; i < years; i++) {
    balance = (balance + annualContribution) * (1 + returnRate);
  }

  return {
    finalBalance: Math.round(balance),
    totalContributed,
    totalGrowth: Math.round(balance - totalContributed),
  };
}

// HYSA vs Checking Calculator
export function calculateHYSABenefit(
  balance: number,
  hysaApy: number = 4.5,
  checkingApy: number = 0.01,
  years: number = 1
): { hysaEarnings: number; checkingEarnings: number; difference: number } {
  const hysaEarnings = balance * (Math.pow(1 + hysaApy / 100, years) - 1);
  const checkingEarnings = balance * (Math.pow(1 + checkingApy / 100, years) - 1);

  return {
    hysaEarnings: Math.round(hysaEarnings * 100) / 100,
    checkingEarnings: Math.round(checkingEarnings * 100) / 100,
    difference: Math.round((hysaEarnings - checkingEarnings) * 100) / 100,
  };
}

// Emergency Fund Calculator
export function calculateEmergencyFund(
  monthlyExpenses: number,
  isVisaHolder: boolean = true
): { minimum: number; recommended: number; withFlightBuffer: number } {
  const baseMonths = isVisaHolder ? 6 : 3;
  const minimum = monthlyExpenses * 3;
  const recommended = monthlyExpenses * baseMonths;
  const withFlightBuffer = recommended + 2500; // Emergency international flight

  return {
    minimum: Math.round(minimum),
    recommended: Math.round(recommended),
    withFlightBuffer: Math.round(withFlightBuffer),
  };
}

// Tax Treaty Savings Calculator
export interface TaxTreatyInfo {
  country: string;
  exemptionAmount: number;
  exemptionType: 'students' | 'all' | 'scholars';
  article: string;
}

export const TAX_TREATIES: TaxTreatyInfo[] = [
  { country: 'China', exemptionAmount: 5000, exemptionType: 'students', article: '20(c)' },
  { country: 'India', exemptionAmount: 5000, exemptionType: 'students', article: '21(2)' },
  { country: 'South Korea', exemptionAmount: 2000, exemptionType: 'students', article: '21(1)' },
  { country: 'Japan', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no student benefit)' },
  { country: 'Germany', exemptionAmount: 9000, exemptionType: 'students', article: '20(4)' },
  { country: 'France', exemptionAmount: 5000, exemptionType: 'students', article: '21(1)' },
  { country: 'United Kingdom', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no student benefit)' },
  { country: 'Canada', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no student benefit)' },
  { country: 'Mexico', exemptionAmount: 3000, exemptionType: 'students', article: '21' },
  { country: 'Brazil', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no treaty)' },
  { country: 'Philippines', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no student benefit)' },
  { country: 'Vietnam', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no treaty)' },
  { country: 'Indonesia', exemptionAmount: 2000, exemptionType: 'students', article: '20' },
  { country: 'Thailand', exemptionAmount: 3000, exemptionType: 'students', article: '22' },
  { country: 'Pakistan', exemptionAmount: 5000, exemptionType: 'students', article: '20' },
  { country: 'Bangladesh', exemptionAmount: 5000, exemptionType: 'students', article: '21' },
  { country: 'Egypt', exemptionAmount: 3000, exemptionType: 'students', article: '23' },
  { country: 'Turkey', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no student benefit)' },
  { country: 'Russia', exemptionAmount: 0, exemptionType: 'students', article: 'N/A (no specific student benefit)' },
  { country: 'Taiwan', exemptionAmount: 5000, exemptionType: 'students', article: '20' },
];

export function calculateTaxTreatySavings(
  country: string,
  income: number,
  federalTaxRate: number = 0.22 // 22% bracket
): { exemption: number; savings: number; treaty: TaxTreatyInfo | null } {
  const treaty = TAX_TREATIES.find(t => t.country.toLowerCase() === country.toLowerCase()) || null;

  if (!treaty || treaty.exemptionAmount === 0) {
    return { exemption: 0, savings: 0, treaty };
  }

  const exemption = Math.min(treaty.exemptionAmount, income);
  const savings = exemption * federalTaxRate;

  return { exemption, savings: Math.round(savings), treaty };
}

// Investment Growth Calculator
export function calculateInvestmentGrowth(
  initialInvestment: number,
  monthlyContribution: number,
  years: number,
  annualReturn: number = 0.07
): { finalBalance: number; totalContributed: number; totalGrowth: number; yearByYear: number[] } {
  const monthlyReturn = annualReturn / 12;
  const months = years * 12;
  let balance = initialInvestment;
  const yearByYear: number[] = [initialInvestment];

  for (let i = 1; i <= months; i++) {
    balance = (balance + monthlyContribution) * (1 + monthlyReturn);
    if (i % 12 === 0) {
      yearByYear.push(Math.round(balance));
    }
  }

  const totalContributed = initialInvestment + (monthlyContribution * months);

  return {
    finalBalance: Math.round(balance),
    totalContributed,
    totalGrowth: Math.round(balance - totalContributed),
    yearByYear,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getTipsByCategory(category: TipCategory): ProTip[] {
  return ALL_TIPS.filter(tip => tip.category === category);
}

export function getTipsByLevel(level: UserLevel): ProTip[] {
  const levelOrder: UserLevel[] = ['beginner', 'intermediate', 'advanced'];
  const maxIndex = levelOrder.indexOf(level);
  return ALL_TIPS.filter(tip => levelOrder.indexOf(tip.userLevel) <= maxIndex);
}

export function getTipsByCategoryAndLevel(category: TipCategory, level: UserLevel): ProTip[] {
  const levelOrder: UserLevel[] = ['beginner', 'intermediate', 'advanced'];
  const maxIndex = levelOrder.indexOf(level);
  return ALL_TIPS.filter(
    tip => tip.category === category && levelOrder.indexOf(tip.userLevel) <= maxIndex
  );
}

export function getVisaRelevantTips(): ProTip[] {
  return ALL_TIPS.filter(tip => tip.visaRelevant);
}

export function getBeginnerTips(): ProTip[] {
  return ALL_TIPS.filter(tip => tip.userLevel === 'beginner');
}

export function getWarnings(): ProTip[] {
  return ALL_TIPS.filter(tip => tip.isWarning);
}

export function searchTips(query: string): ProTip[] {
  const lowerQuery = query.toLowerCase();
  return ALL_TIPS.filter(
    tip =>
      tip.headline.toLowerCase().includes(lowerQuery) ||
      tip.explanation.toLowerCase().includes(lowerQuery) ||
      tip.whyItMatters.toLowerCase().includes(lowerQuery)
  );
}

// Category metadata
export const CATEGORY_INFO: Record<TipCategory, { label: string; icon: string; description: string; minLevel: UserLevel }> = {
  hysa: { label: 'High-Yield Savings', icon: '🏦', description: 'Maximize your savings interest', minLevel: 'beginner' },
  emergency_fund: { label: 'Emergency Fund', icon: '🛡️', description: 'Financial safety net', minLevel: 'beginner' },
  credit_cards: { label: 'Credit Cards', icon: '💳', description: 'Build credit & earn rewards', minLevel: 'beginner' },
  tax: { label: 'Taxes', icon: '📋', description: 'Tax strategies for visa holders', minLevel: 'beginner' },
  roth_ira: { label: 'Roth IRA', icon: '📈', description: 'Tax-free retirement growth', minLevel: 'intermediate' },
  '401k': { label: '401(k)', icon: '💼', description: 'Employer retirement plans', minLevel: 'intermediate' },
  order_of_operations: { label: 'Order of Operations', icon: '📊', description: 'The optimal savings flowchart', minLevel: 'intermediate' },
  hsa: { label: 'HSA', icon: '🏥', description: 'Health savings with tax benefits', minLevel: 'advanced' },
  investing: { label: 'Investing', icon: '💹', description: 'Long-term wealth building', minLevel: 'advanced' },
  warnings: { label: 'Warnings', icon: '⚠️', description: 'Mistakes to avoid', minLevel: 'beginner' },
};

// Progress tracking - steps completed
export interface FinanceProgress {
  hasEmergencyFund: boolean;
  hasHYSA: boolean;
  hasCreditCard: boolean;
  noHighInterestDebt: boolean;
  has401kMatch: boolean;
  hasRothIRA: boolean;
  fullEmergencyFund: boolean;
  hasHSA: boolean;
  max401k: boolean;
  hasTaxableBrokerage: boolean;
}

export function calculateProgressSteps(progress: FinanceProgress, level: UserLevel): { completed: number; total: number; nextStep: string } {
  // Steps available by level
  const beginnerSteps = ['hasEmergencyFund', 'hasHYSA', 'hasCreditCard', 'noHighInterestDebt'];
  const intermediateSteps = [...beginnerSteps, 'has401kMatch', 'hasRothIRA', 'fullEmergencyFund'];
  const advancedSteps = [...intermediateSteps, 'hasHSA', 'max401k', 'hasTaxableBrokerage'];

  const steps = level === 'beginner' ? beginnerSteps : level === 'intermediate' ? intermediateSteps : advancedSteps;
  const total = steps.length;
  const completed = steps.filter(step => progress[step as keyof FinanceProgress]).length;

  // Find next step
  const nextStepKey = steps.find(step => !progress[step as keyof FinanceProgress]);
  const nextStepMessages: Record<string, string> = {
    hasEmergencyFund: 'Start your emergency fund',
    hasHYSA: 'Open a high-yield savings account',
    hasCreditCard: 'Get your first credit card',
    noHighInterestDebt: 'Pay off high-interest debt',
    has401kMatch: 'Get your full 401(k) match',
    hasRothIRA: 'Open a Roth IRA',
    fullEmergencyFund: 'Build 6-month emergency fund',
    hasHSA: 'Open and fund an HSA',
    max401k: 'Max out your 401(k)',
    hasTaxableBrokerage: 'Start taxable brokerage investing',
  };

  const nextStep = nextStepKey ? nextStepMessages[nextStepKey] : 'You\'re crushing it!';

  return { completed, total, nextStep };
}
