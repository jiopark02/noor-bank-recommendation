// Savings & Investment Data for Noor
// Supports US, UK, and Canada specific accounts

export type AccountLevel = 'undergrad' | 'grad' | 'working' | 'all';
export type AccountType = 'hysa' | 'roth_ira' | '401k' | 'hsa' | 'brokerage' | 'isa' | 'lisa' | 'tfsa' | 'rrsp' | 'fhsa';
export type VisaStatus = 'F-1' | 'F-1 OPT' | 'H-1B' | 'Green Card' | 'Citizen' | 'Other';
export type UKVisaStatus = 'Student Visa' | 'Graduate Visa' | 'Skilled Worker' | 'Settled Status' | 'UK Citizen' | 'Other';
export type CAVisaStatus = 'Study Permit' | 'PGWP' | 'Work Permit' | 'PR' | 'CA Citizen' | 'Other';
export type Country = 'US' | 'UK' | 'CA';

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

// ============================================================================
// UK SAVINGS ACCOUNTS (ISA - Individual Savings Account)
// ============================================================================

export interface UKSavingsAccount {
  id: string;
  name: string;
  bank: string;
  aer: number; // Annual Equivalent Rate (UK equivalent of APY)
  min_balance: number;
  min_to_open: number;
  fscs_protected: boolean; // UK's deposit protection scheme
  features: string[];
  pros: string[];
  cons: string[];
  best_for: string;
  link: string;
  logo_url?: string;
  no_nin_required: boolean; // No National Insurance Number required
  type: 'cash_isa' | 'stocks_shares_isa' | 'lifetime_isa' | 'easy_access' | 'fixed_rate';
}

export const UK_SAVINGS_ACCOUNTS: UKSavingsAccount[] = [
  // Cash ISAs - Tax-free savings
  {
    id: 'monzo_isa',
    name: 'Monzo Cash ISA',
    bank: 'Monzo',
    aer: 4.16,
    min_balance: 0,
    min_to_open: 1,
    fscs_protected: true,
    features: ['In-app ISA management', 'Instant access', 'No fees', 'Easy transfers'],
    pros: ['Great app experience', 'No NIN required to open', 'Instant withdrawals'],
    cons: ['Lower rate than some competitors', 'No fixed rate options'],
    best_for: 'Best for easy mobile management',
    link: 'https://monzo.com/isa/',
    no_nin_required: true,
    type: 'cash_isa',
  },
  {
    id: 'chase_uk_saver',
    name: 'Chase Saver Account',
    bank: 'Chase UK',
    aer: 3.75,
    min_balance: 0,
    min_to_open: 0,
    fscs_protected: true,
    features: ['1% cashback on spending', 'Round-ups', 'Easy access', 'No fees'],
    pros: ['Great current account combo', 'Round-ups feature', '1% cashback debit card'],
    cons: ['Not an ISA', 'Lower rate than ISAs'],
    best_for: 'Best for cashback + savings combo',
    link: 'https://www.chase.co.uk/',
    no_nin_required: true,
    type: 'easy_access',
  },
  {
    id: 'marcus_uk',
    name: 'Marcus Online Savings',
    bank: 'Goldman Sachs (Marcus)',
    aer: 4.5,
    min_balance: 0,
    min_to_open: 1,
    fscs_protected: true,
    features: ['No fees', 'Easy access', 'High interest', 'Simple interface'],
    pros: ['Top rates', 'Backed by Goldman Sachs', 'Easy withdrawals'],
    cons: ['No current account', 'No mobile app (web only)'],
    best_for: 'Best for highest interest rate',
    link: 'https://www.marcus.co.uk/',
    no_nin_required: false,
    type: 'easy_access',
  },
  {
    id: 'trading212_isa',
    name: 'Trading 212 Cash ISA',
    bank: 'Trading 212',
    aer: 5.1,
    min_balance: 0,
    min_to_open: 1,
    fscs_protected: true,
    features: ['Highest ISA rate', 'Easy access', 'Investment options', 'Great app'],
    pros: ['Market-leading rate', 'Can switch to Stocks ISA', 'Modern app'],
    cons: ['Newer to banking', 'Customer support mixed reviews'],
    best_for: 'Best rate for Cash ISA',
    link: 'https://www.trading212.com/',
    no_nin_required: true,
    type: 'cash_isa',
  },
  {
    id: 'chip_isa',
    name: 'Chip Cash ISA',
    bank: 'Chip',
    aer: 4.84,
    min_balance: 0,
    min_to_open: 1,
    fscs_protected: true,
    features: ['AI-powered auto-saving', 'Round-ups', 'ISA and savings', 'Smart saving rules'],
    pros: ['Automatic savings', 'Good ISA rate', 'Clever saving features'],
    cons: ['Premium features cost extra', 'Not a full bank'],
    best_for: 'Best for automatic saving',
    link: 'https://www.getchip.uk/',
    no_nin_required: true,
    type: 'cash_isa',
  },
];

// UK Investment Account Types
export interface UKInvestmentAccount {
  id: string;
  name: string;
  type: 'cash_isa' | 'stocks_shares_isa' | 'lifetime_isa' | 'sipp';
  description: string;
  annual_limit?: number; // In GBP
  tax_benefit: string;
  requirements: string[];
  visa_eligible: UKVisaStatus[];
  best_for: string;
  providers: UKInvestmentProvider[];
}

export interface UKInvestmentProvider {
  id: string;
  name: string;
  min_investment: number;
  annual_fee: string;
  features: string[];
  link: string;
}

export const UK_INVESTMENT_ACCOUNTS: UKInvestmentAccount[] = [
  {
    id: 'stocks_shares_isa',
    name: 'Stocks & Shares ISA',
    type: 'stocks_shares_isa',
    description: 'Tax-free investing. No capital gains tax or dividend tax on your investments. £20,000 annual limit shared across all ISA types.',
    annual_limit: 20000,
    tax_benefit: 'No capital gains tax, no dividend tax, no income tax on gains',
    requirements: [
      'Must be UK resident',
      'Must be 18+ years old',
      'Can only pay into one Stocks & Shares ISA per tax year',
    ],
    visa_eligible: ['Student Visa', 'Graduate Visa', 'Skilled Worker', 'Settled Status', 'UK Citizen'],
    best_for: 'Long-term investing with tax-free growth',
    providers: [
      {
        id: 'vanguard_uk',
        name: 'Vanguard UK',
        min_investment: 100,
        annual_fee: '0.15% (capped at £375)',
        features: ['Low-cost index funds', 'Simple interface', 'Trusted brand', 'Great for beginners'],
        link: 'https://www.vanguardinvestor.co.uk/',
      },
      {
        id: 'trading212_stocks_isa',
        name: 'Trading 212',
        min_investment: 1,
        annual_fee: 'Free',
        features: ['No fees', 'Fractional shares', 'Great app', 'Free stocks'],
        link: 'https://www.trading212.com/',
      },
      {
        id: 'freetrade',
        name: 'Freetrade',
        min_investment: 2,
        annual_fee: '£59.88/year for ISA',
        features: ['Simple interface', 'Fractional shares', 'Good stock selection'],
        link: 'https://freetrade.io/',
      },
      {
        id: 'hargreaves',
        name: 'Hargreaves Lansdown',
        min_investment: 100,
        annual_fee: '0.45% (capped)',
        features: ['Excellent research', 'Wide fund selection', 'Great customer service'],
        link: 'https://www.hl.co.uk/',
      },
    ],
  },
  {
    id: 'lifetime_isa',
    name: 'Lifetime ISA (LISA)',
    type: 'lifetime_isa',
    description: 'Save for your first home or retirement. Government adds 25% bonus on your contributions (up to £1,000/year free money).',
    annual_limit: 4000,
    tax_benefit: '25% government bonus (up to £1,000 per year)',
    requirements: [
      'Must be 18-39 years old to open',
      'Must be UK resident',
      'Can only use for first home (£450k max) or retirement (age 60+)',
      '25% penalty if withdrawn for other reasons',
    ],
    visa_eligible: ['Graduate Visa', 'Skilled Worker', 'Settled Status', 'UK Citizen'],
    best_for: 'First-time home buyers or young retirement savers',
    providers: [
      {
        id: 'moneybox_lisa',
        name: 'Moneybox',
        min_investment: 1,
        annual_fee: '0.45%',
        features: ['Great app', 'Stocks & Cash LISA options', 'Round-ups'],
        link: 'https://www.moneyboxapp.com/',
      },
      {
        id: 'aj_bell_lisa',
        name: 'AJ Bell',
        min_investment: 25,
        annual_fee: '0.25%',
        features: ['Low fees', 'Good fund selection', 'Investment LISA'],
        link: 'https://www.ajbell.co.uk/',
      },
    ],
  },
];

// ============================================================================
// CANADA SAVINGS ACCOUNTS (TFSA, RRSP, FHSA)
// ============================================================================

export interface CASavingsAccount {
  id: string;
  name: string;
  bank: string;
  interest_rate: number; // Interest rate percentage
  min_balance: number;
  min_to_open: number;
  cdic_insured: boolean; // Canada Deposit Insurance Corporation
  features: string[];
  pros: string[];
  cons: string[];
  best_for: string;
  link: string;
  logo_url?: string;
  no_sin_required: boolean; // No Social Insurance Number required to open
  type: 'tfsa' | 'savings' | 'hisa';
}

export const CA_SAVINGS_ACCOUNTS: CASavingsAccount[] = [
  {
    id: 'eq_bank_tfsa',
    name: 'EQ Bank TFSA Savings',
    bank: 'EQ Bank',
    interest_rate: 4.0,
    min_balance: 0,
    min_to_open: 0,
    cdic_insured: true,
    features: ['No fees', 'High interest', 'No minimum balance', 'Great mobile app'],
    pros: ['Consistently high rates', 'No fees ever', 'Great digital experience'],
    cons: ['No physical branches', 'No US dollar accounts'],
    best_for: 'Best overall for TFSA',
    link: 'https://www.eqbank.ca/',
    no_sin_required: false,
    type: 'tfsa',
  },
  {
    id: 'tangerine_savings',
    name: 'Tangerine Savings Account',
    bank: 'Tangerine',
    interest_rate: 5.0, // Promotional rate
    min_balance: 0,
    min_to_open: 0,
    cdic_insured: true,
    features: ['Promo rates for new customers', 'No fees', 'Owned by Scotiabank', 'Great app'],
    pros: ['High promo rates', 'Backed by Scotiabank', 'Easy to open'],
    cons: ['Promo rate drops after 5 months', 'No SIN required initially'],
    best_for: 'Best for promotional rates',
    link: 'https://www.tangerine.ca/',
    no_sin_required: true,
    type: 'savings',
  },
  {
    id: 'simplii_hisa',
    name: 'Simplii High Interest Savings',
    bank: 'Simplii Financial',
    interest_rate: 5.25, // Promotional rate
    min_balance: 0,
    min_to_open: 0,
    cdic_insured: true,
    features: ['High promo rates', 'No fees', 'CIBC partnership', 'Free banking'],
    pros: ['CIBC ATM access', 'Great promo rates', 'Free chequing too'],
    cons: ['Promo rate temporary', 'Limited branches'],
    best_for: 'Best with Simplii chequing account',
    link: 'https://www.simplii.com/',
    no_sin_required: true,
    type: 'hisa',
  },
  {
    id: 'wealthsimple_save',
    name: 'Wealthsimple Save',
    bank: 'Wealthsimple',
    interest_rate: 4.0,
    min_balance: 0,
    min_to_open: 0,
    cdic_insured: true,
    features: ['TFSA and regular savings', 'Round-ups', 'Great app', 'Investment integration'],
    pros: ['All-in-one platform', 'Easy investing', 'Modern experience'],
    cons: ['Rate not always highest', 'Customer service mixed'],
    best_for: 'Best for saving + investing combo',
    link: 'https://www.wealthsimple.com/en-ca/save',
    no_sin_required: false,
    type: 'tfsa',
  },
  {
    id: 'neo_savings',
    name: 'Neo High-Interest Savings',
    bank: 'Neo Financial',
    interest_rate: 4.0,
    min_balance: 0,
    min_to_open: 0,
    cdic_insured: true,
    features: ['Cashback credit card', 'No fees', 'Modern app', 'Instant transfers'],
    pros: ['Great cashback card combo', 'Modern experience', 'Good rates'],
    cons: ['Newer bank', 'Limited features'],
    best_for: 'Best for cashback + savings',
    link: 'https://www.neofinancial.com/',
    no_sin_required: true,
    type: 'savings',
  },
];

// Canada Investment Account Types
export interface CAInvestmentAccount {
  id: string;
  name: string;
  type: 'tfsa' | 'rrsp' | 'fhsa' | 'non_registered';
  description: string;
  annual_limit?: number | string; // In CAD, can be string for percentage-based limits
  tax_benefit: string;
  requirements: string[];
  visa_eligible: CAVisaStatus[];
  best_for: string;
  providers: CAInvestmentProvider[];
}

export interface CAInvestmentProvider {
  id: string;
  name: string;
  min_investment: number;
  annual_fee: string;
  features: string[];
  link: string;
}

export const CA_INVESTMENT_ACCOUNTS: CAInvestmentAccount[] = [
  {
    id: 'tfsa',
    name: 'Tax-Free Savings Account (TFSA)',
    type: 'tfsa',
    description: 'Tax-free investment growth and withdrawals. Unlike RRSP, you can withdraw anytime without penalty. Contribution room carries forward.',
    annual_limit: 7000, // 2024 limit
    tax_benefit: 'Tax-free growth, tax-free withdrawals anytime',
    requirements: [
      'Must be Canadian resident',
      'Must be 18+ with valid SIN',
      'Contribution room starts accumulating at age 18',
    ],
    visa_eligible: ['Study Permit', 'PGWP', 'Work Permit', 'PR', 'CA Citizen'],
    best_for: 'Everyone - flexible tax-free savings/investing',
    providers: [
      {
        id: 'wealthsimple_trade',
        name: 'Wealthsimple Trade',
        min_investment: 1,
        annual_fee: 'Free',
        features: ['No commissions', 'Fractional shares', 'Great app', 'Auto-invest'],
        link: 'https://www.wealthsimple.com/en-ca/trade',
      },
      {
        id: 'questrade',
        name: 'Questrade',
        min_investment: 1000,
        annual_fee: 'Free (no inactivity fee)',
        features: ['Low commissions', 'Free ETF purchases', 'Good research tools'],
        link: 'https://www.questrade.com/',
      },
      {
        id: 'td_direct',
        name: 'TD Direct Investing',
        min_investment: 0,
        annual_fee: 'Free with $15k+ balance',
        features: ['TD e-Series funds', 'Great research', 'Physical branches'],
        link: 'https://www.td.com/ca/en/investing/direct-investing',
      },
    ],
  },
  {
    id: 'rrsp',
    name: 'Registered Retirement Savings Plan (RRSP)',
    type: 'rrsp',
    description: 'Tax-deferred retirement savings. Contributions reduce your taxable income now, but withdrawals are taxed in retirement (ideally at a lower rate).',
    annual_limit: '18% of income (max ~$31,560)',
    tax_benefit: 'Tax deduction now, tax-deferred growth, taxed on withdrawal',
    requirements: [
      'Must have Canadian earned income',
      'Must file Canadian taxes',
      'Must be under 71 years old',
    ],
    visa_eligible: ['PGWP', 'Work Permit', 'PR', 'CA Citizen'],
    best_for: 'Higher income earners expecting lower tax rate in retirement',
    providers: [
      {
        id: 'wealthsimple_rrsp',
        name: 'Wealthsimple',
        min_investment: 1,
        annual_fee: '0.4-0.5%',
        features: ['Robo-advisor', 'Auto-rebalancing', 'Great app', 'Low minimums'],
        link: 'https://www.wealthsimple.com/en-ca/invest',
      },
      {
        id: 'questrade_rrsp',
        name: 'Questrade',
        min_investment: 1000,
        annual_fee: 'Free',
        features: ['Self-directed', 'Low commissions', 'Good tools'],
        link: 'https://www.questrade.com/',
      },
      {
        id: 'rbc_direct',
        name: 'RBC Direct Investing',
        min_investment: 0,
        annual_fee: 'Free with $15k+ balance',
        features: ['Great research', 'RBC integration', 'Physical support'],
        link: 'https://www.rbcdirectinvesting.com/',
      },
    ],
  },
  {
    id: 'fhsa',
    name: 'First Home Savings Account (FHSA)',
    type: 'fhsa',
    description: 'New account combining RRSP + TFSA benefits for first-time home buyers. Tax-deductible contributions AND tax-free withdrawals for home purchase.',
    annual_limit: 8000, // Max $40,000 lifetime
    tax_benefit: 'Tax deduction on contributions + tax-free growth + tax-free withdrawal for home',
    requirements: [
      'Must be first-time home buyer',
      'Must be Canadian resident',
      'Must be 18-71 years old',
      'Must use within 15 years or transfer to RRSP',
    ],
    visa_eligible: ['PR', 'CA Citizen'],
    best_for: 'First-time home buyers - best of both worlds',
    providers: [
      {
        id: 'wealthsimple_fhsa',
        name: 'Wealthsimple',
        min_investment: 1,
        annual_fee: '0.4-0.5%',
        features: ['Easy to open', 'Robo-advisor option', 'Great app'],
        link: 'https://www.wealthsimple.com/en-ca/fhsa',
      },
      {
        id: 'questrade_fhsa',
        name: 'Questrade',
        min_investment: 0,
        annual_fee: 'Free',
        features: ['Self-directed', 'Free ETF purchases', 'Low minimums'],
        link: 'https://www.questrade.com/',
      },
      {
        id: 'eq_bank_fhsa',
        name: 'EQ Bank FHSA',
        min_investment: 0,
        annual_fee: 'Free',
        features: ['High interest savings option', 'GIC option', 'No fees'],
        link: 'https://www.eqbank.ca/',
      },
    ],
  },
];

// ============================================================================
// COUNTRY-SPECIFIC GETTERS
// ============================================================================

export function getSavingsAccountsByCountry(country: Country) {
  switch (country) {
    case 'UK':
      return UK_SAVINGS_ACCOUNTS;
    case 'CA':
      return CA_SAVINGS_ACCOUNTS;
    case 'US':
    default:
      return HYSA_ACCOUNTS;
  }
}

export function getInvestmentAccountsByCountry(country: Country) {
  switch (country) {
    case 'UK':
      return UK_INVESTMENT_ACCOUNTS;
    case 'CA':
      return CA_INVESTMENT_ACCOUNTS;
    case 'US':
    default:
      return INVESTMENT_ACCOUNTS;
  }
}

export function getCurrencySymbol(country: Country): string {
  switch (country) {
    case 'UK':
      return '£';
    case 'CA':
      return 'C$';
    case 'US':
    default:
      return '$';
  }
}

export function getDepositProtection(country: Country): { name: string; limit: string } {
  switch (country) {
    case 'UK':
      return { name: 'FSCS', limit: '£85,000' };
    case 'CA':
      return { name: 'CDIC', limit: 'C$100,000' };
    case 'US':
    default:
      return { name: 'FDIC', limit: '$250,000' };
  }
}

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
