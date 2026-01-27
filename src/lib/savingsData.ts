// Savings & Investment Data for Noor

export type AccountLevel = 'undergrad' | 'grad' | 'working' | 'all';
export type AccountType = 'hysa' | 'roth_ira' | '401k' | 'hsa' | 'brokerage';
export type VisaStatus = 'F-1' | 'F-1 OPT' | 'H-1B' | 'Green Card' | 'Citizen' | 'Other';

// High-Yield Savings Accounts
export interface HYSAAccount {
  id: string;
  name: string;
  bank: string;
  apy: number; // Current APY percentage
  min_balance: number;
  min_to_open: number;
  fdic_insured: boolean;
  features: string[];
  pros: string[];
  cons: string[];
  best_for: string;
  link: string;
  logo_url?: string;
  f1_friendly: boolean;
}

export const HYSA_ACCOUNTS: HYSAAccount[] = [
  {
    id: 'marcus',
    name: 'Marcus Online Savings',
    bank: 'Goldman Sachs',
    apy: 4.5,
    min_balance: 0,
    min_to_open: 0,
    fdic_insured: true,
    features: ['No fees', 'No minimum balance', 'Easy transfers', '24/7 customer support'],
    pros: ['Top APY rates', 'No monthly fees', 'Backed by Goldman Sachs'],
    cons: ['No physical branches', 'No checking account option'],
    best_for: 'Best overall for high APY',
    link: 'https://www.marcus.com/us/en/savings/high-yield-savings',
    f1_friendly: true,
  },
  {
    id: 'ally',
    name: 'Ally Online Savings',
    bank: 'Ally Bank',
    apy: 4.2,
    min_balance: 0,
    min_to_open: 0,
    fdic_insured: true,
    features: ['Buckets for organizing savings', 'Round-up transfers', 'No fees', 'Great mobile app'],
    pros: ['Excellent app', 'Savings buckets feature', 'No fees or minimums'],
    cons: ['No physical branches', 'ACH transfers take 1-3 days'],
    best_for: 'Best for organizing multiple goals',
    link: 'https://www.ally.com/bank/online-savings-account/',
    f1_friendly: true,
  },
  {
    id: 'discover',
    name: 'Discover Online Savings',
    bank: 'Discover',
    apy: 4.0,
    min_balance: 0,
    min_to_open: 0,
    fdic_insured: true,
    features: ['No fees', 'Cash back debit card available', '24/7 US-based support'],
    pros: ['Great customer service', 'Easy to pair with Discover credit card', 'No fees'],
    cons: ['Slightly lower APY', 'No savings buckets'],
    best_for: 'Best if you have Discover credit card',
    link: 'https://www.discover.com/online-banking/savings-account/',
    f1_friendly: true,
  },
  {
    id: 'sofi',
    name: 'SoFi Savings',
    bank: 'SoFi',
    apy: 4.3,
    min_balance: 0,
    min_to_open: 0,
    fdic_insured: true,
    features: ['Checking + Savings combo', 'Early direct deposit', 'No fees', 'Vaults for goals'],
    pros: ['All-in-one banking', 'Early paycheck access', 'Good APY'],
    cons: ['Need direct deposit for best APY', 'Newer bank'],
    best_for: 'Best for all-in-one banking',
    link: 'https://www.sofi.com/banking/',
    f1_friendly: true,
  },
  {
    id: 'wealthfront',
    name: 'Wealthfront Cash Account',
    bank: 'Wealthfront',
    apy: 4.5,
    min_balance: 0,
    min_to_open: 1,
    fdic_insured: true,
    features: ['$8M FDIC insurance via partners', 'Autopilot savings', 'Investment account integration'],
    pros: ['High FDIC coverage', 'Great for investors', 'Self-driving money features'],
    cons: ['Not a traditional bank', 'Need $1 to open'],
    best_for: 'Best if you plan to invest too',
    link: 'https://www.wealthfront.com/cash',
    f1_friendly: true,
  },
];

// Investment Account Types
export interface InvestmentAccount {
  id: string;
  name: string;
  type: AccountType;
  description: string;
  annual_limit?: number;
  tax_benefit: string;
  requirements: string[];
  visa_eligible: VisaStatus[];
  best_for: string;
  providers: InvestmentProvider[];
}

export interface InvestmentProvider {
  id: string;
  name: string;
  min_investment: number;
  features: string[];
  link: string;
}

export const INVESTMENT_ACCOUNTS: InvestmentAccount[] = [
  {
    id: 'roth_ira',
    name: 'Roth IRA',
    type: 'roth_ira',
    description: 'Tax-free growth and tax-free withdrawals in retirement. You contribute after-tax money, but never pay taxes on gains.',
    annual_limit: 7000,
    tax_benefit: 'Tax-free growth, tax-free withdrawals after 59½',
    requirements: [
      'Must have earned income (job, OPT, etc.)',
      'Income must be below limit (~$161K single)',
      'Must be a tax resident (pass substantial presence test)',
    ],
    visa_eligible: ['F-1 OPT', 'H-1B', 'Green Card', 'Citizen'],
    best_for: 'Young people who expect higher taxes in retirement',
    providers: [
      {
        id: 'fidelity',
        name: 'Fidelity',
        min_investment: 0,
        features: ['No minimums', 'Zero expense ratio index funds', 'Great app', 'Fractional shares'],
        link: 'https://www.fidelity.com/retirement-ira/roth-ira',
      },
      {
        id: 'schwab',
        name: 'Charles Schwab',
        min_investment: 0,
        features: ['No minimums', 'Great research tools', '24/7 support', 'Physical branches'],
        link: 'https://www.schwab.com/ira/roth-ira',
      },
      {
        id: 'vanguard',
        name: 'Vanguard',
        min_investment: 0,
        features: ['Pioneer of index investing', 'Low-cost funds', 'Investor-owned company'],
        link: 'https://investor.vanguard.com/ira/roth-ira',
      },
    ],
  },
  {
    id: '401k',
    name: '401(k)',
    type: '401k',
    description: 'Employer-sponsored retirement account. Often includes free money through employer matching.',
    annual_limit: 23000,
    tax_benefit: 'Pre-tax contributions reduce taxable income. Traditional: taxed at withdrawal. Roth 401(k): tax-free withdrawal.',
    requirements: [
      'Must be offered by your employer',
      'Usually need to be full-time employee',
      'May have waiting period (30-90 days)',
    ],
    visa_eligible: ['F-1 OPT', 'H-1B', 'Green Card', 'Citizen'],
    best_for: 'Anyone with employer match (it\'s free money!)',
    providers: [],
  },
  {
    id: 'hsa',
    name: 'Health Savings Account (HSA)',
    type: 'hsa',
    description: 'Triple tax advantage: tax-deductible contributions, tax-free growth, tax-free withdrawals for medical expenses.',
    annual_limit: 4150,
    tax_benefit: 'Triple tax advantage: deductible contributions, tax-free growth, tax-free medical withdrawals',
    requirements: [
      'Must have High Deductible Health Plan (HDHP)',
      'Cannot be on Medicare',
      'Cannot be claimed as dependent',
    ],
    visa_eligible: ['F-1 OPT', 'H-1B', 'Green Card', 'Citizen'],
    best_for: 'People with HDHP who can afford to not touch the money',
    providers: [
      {
        id: 'fidelity_hsa',
        name: 'Fidelity HSA',
        min_investment: 0,
        features: ['No fees', 'Can invest in stocks/funds', 'No minimum balance'],
        link: 'https://www.fidelity.com/go/hsa/why-hsa',
      },
      {
        id: 'lively',
        name: 'Lively',
        min_investment: 0,
        features: ['No fees for individuals', 'TD Ameritrade integration', 'Modern interface'],
        link: 'https://livelyme.com/',
      },
    ],
  },
];

// Eligibility Quiz
export interface EligibilityQuestion {
  id: string;
  question: string;
  options: { value: string; label: string }[];
}

export const ROTH_IRA_ELIGIBILITY_QUESTIONS: EligibilityQuestion[] = [
  {
    id: 'visa_status',
    question: 'What is your current visa status?',
    options: [
      { value: 'f1_student', label: 'F-1 Student (no work authorization)' },
      { value: 'f1_opt', label: 'F-1 with OPT/CPT (working)' },
      { value: 'h1b', label: 'H-1B' },
      { value: 'green_card', label: 'Green Card / Permanent Resident' },
      { value: 'citizen', label: 'US Citizen' },
      { value: 'other', label: 'Other visa' },
    ],
  },
  {
    id: 'earned_income',
    question: 'Do you have earned income (wages, salary, self-employment)?',
    options: [
      { value: 'yes', label: 'Yes, I have a job or will have one this year' },
      { value: 'no', label: 'No, I only have scholarships/stipends/investments' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    id: 'us_years',
    question: 'How many years have you been in the US?',
    options: [
      { value: 'less_than_5', label: 'Less than 5 years' },
      { value: '5_or_more', label: '5 years or more' },
    ],
  },
  {
    id: 'income_level',
    question: 'What\'s your expected annual income this year?',
    options: [
      { value: 'under_50k', label: 'Under $50,000' },
      { value: '50k_100k', label: '$50,000 - $100,000' },
      { value: '100k_150k', label: '$100,000 - $150,000' },
      { value: 'over_150k', label: 'Over $150,000' },
    ],
  },
];

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  nextSteps: string[];
  alternativeOptions?: string[];
}

export function checkRothIRAEligibility(answers: Record<string, string>): EligibilityResult {
  const { visa_status, earned_income, us_years, income_level } = answers;

  // F-1 students without work authorization
  if (visa_status === 'f1_student' && earned_income === 'no') {
    return {
      eligible: false,
      reason: 'You need earned income (from a job) to contribute to a Roth IRA.',
      nextSteps: [
        'Focus on building your emergency fund first',
        'Look into HYSA for better savings returns',
        'When you get CPT/OPT, you can start contributing',
      ],
      alternativeOptions: ['Open a HYSA for your savings', 'Start learning about investing with paper trading'],
    };
  }

  // Non-resident aliens (less than 5 years in US on F-1)
  if (visa_status === 'f1_opt' && us_years === 'less_than_5') {
    return {
      eligible: false,
      reason: 'As a non-resident alien (F-1 for less than 5 years), you typically can\'t contribute to a Roth IRA.',
      nextSteps: [
        'Keep track of your days in the US for the substantial presence test',
        'Once you become a resident for tax purposes, you can open one',
        'Focus on HYSA and taxable brokerage accounts for now',
      ],
      alternativeOptions: ['Open a regular brokerage account', 'Max out your emergency fund in a HYSA'],
    };
  }

  // Income too high
  if (income_level === 'over_150k') {
    return {
      eligible: false,
      reason: 'Your income may be too high for direct Roth IRA contributions (limit is ~$161K for single filers).',
      nextSteps: [
        'Look into "Backdoor Roth IRA" strategy',
        'Max out your 401(k) first if available',
        'Consider a traditional IRA instead',
      ],
      alternativeOptions: ['Backdoor Roth IRA', 'Max 401(k) contributions', 'Taxable brokerage account'],
    };
  }

  // No earned income
  if (earned_income === 'no') {
    return {
      eligible: false,
      reason: 'You need earned income to contribute to a Roth IRA. Scholarships, stipends, and investment income don\'t count.',
      nextSteps: [
        'Once you have a job with wages, you can contribute',
        'Focus on HYSA for your savings in the meantime',
      ],
      alternativeOptions: ['HYSA for savings', 'Learn about investing while you wait'],
    };
  }

  // Eligible!
  return {
    eligible: true,
    reason: 'Great news! You appear eligible to open a Roth IRA.',
    nextSteps: [
      'Choose a broker (we recommend Fidelity or Schwab)',
      'Open the account (takes about 15 minutes)',
      'Set up automatic contributions',
      'Choose your investments (target date fund is easiest)',
    ],
  };
}

// Savings Goals
export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline?: string;
  category: 'emergency' | 'travel' | 'big_purchase' | 'education' | 'other';
  monthly_contribution?: number;
}

export const DEFAULT_SAVINGS_GOALS: SavingsGoal[] = [
  {
    id: 'emergency_fund',
    name: 'Emergency Fund',
    target_amount: 5000,
    current_amount: 0,
    category: 'emergency',
  },
];

export const EMERGENCY_FUND_GUIDE = {
  title: 'Emergency Fund 101',
  subtitle: 'Your financial safety net',
  sections: [
    {
      title: 'Why do you need one?',
      content: 'Life is unpredictable. Your car breaks down, you get sick, or you lose your job. An emergency fund keeps you from going into debt when these things happen.',
    },
    {
      title: 'How much should you save?',
      content: 'Start with $1,000 as a mini emergency fund. Then work up to 3-6 months of essential expenses. As a student, aim for at least $2,000-$5,000.',
    },
    {
      title: 'Where should you keep it?',
      content: 'In a High-Yield Savings Account (HYSA). It\'s safe, earns interest, and you can access it when needed. Never invest your emergency fund.',
    },
    {
      title: 'How to build it?',
      content: 'Set up automatic transfers from your checking account. Even $50/month adds up. Treat it like a bill you have to pay.',
    },
  ],
};

// Calculator functions
export function calculateHYSAEarnings(principal: number, apy: number, years: number = 1): number {
  return principal * (Math.pow(1 + apy / 100, years) - 1);
}

export function calculateMonthsToGoal(
  currentAmount: number,
  targetAmount: number,
  monthlyContribution: number
): number {
  if (monthlyContribution <= 0) return Infinity;
  return Math.ceil((targetAmount - currentAmount) / monthlyContribution);
}

// Storage keys
export const STORAGE_KEY_SAVINGS_GOALS = 'noor_savings_goals';
export const STORAGE_KEY_REFERRAL_CLICKS = 'noor_referral_clicks';

// Track referral clicks (for future affiliate tracking)
export interface ReferralClick {
  account_id: string;
  account_type: 'hysa' | 'brokerage' | 'ira';
  timestamp: string;
  user_id?: string;
}

export function trackReferralClick(click: ReferralClick): void {
  const existingClicks = localStorage.getItem(STORAGE_KEY_REFERRAL_CLICKS);
  const clicks: ReferralClick[] = existingClicks ? JSON.parse(existingClicks) : [];
  clicks.push(click);
  localStorage.setItem(STORAGE_KEY_REFERRAL_CLICKS, JSON.stringify(clicks));
}
