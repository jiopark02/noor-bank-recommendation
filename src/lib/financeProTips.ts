// Comprehensive Finance Pro Tips for International Students
// Research compiled from Reddit, NerdWallet, Bogleheads, The Points Guy, and more

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
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

// ============================================
// HYSA TIPS
// ============================================
export const HYSA_TIPS: ProTip[] = [
  {
    id: 'hysa_1',
    category: 'hysa',
    headline: 'You don\'t need an SSN for most HYSAs',
    explanation: 'Marcus, Ally, Discover, and SoFi all accept ITIN or even just passport + visa documents. Some may require you to call or visit a branch, but it\'s doable.',
    whyItMatters: 'Many international students think they can\'t open a HYSA without SSN. You can start earning 4%+ interest from day one.',
    difficulty: 'beginner',
    visaRelevant: true,
  },
  {
    id: 'hysa_2',
    category: 'hysa',
    headline: 'Interest is taxable income',
    explanation: 'You\'ll get a 1099-INT form if you earn more than $10 in interest. This counts as US-source income and must be reported on your tax return.',
    whyItMatters: 'As an F-1 student, you still need to report this income. Factor taxes into your actual returns (4.5% APY might be ~3.5% after taxes).',
    difficulty: 'intermediate',
    visaRelevant: true,
  },
  {
    id: 'hysa_3',
    category: 'hysa',
    headline: 'Chase bank signup bonuses stack well',
    explanation: 'Open checking ($300 bonus) + savings ($150 bonus) with direct deposit. Then move savings to a real HYSA for better rates.',
    whyItMatters: 'Free $450 for setting up accounts you need anyway. That\'s a week of groceries.',
    actionLabel: 'Check current offers',
    difficulty: 'beginner',
  },
  {
    id: 'hysa_4',
    category: 'hysa',
    headline: 'Rate chase strategically',
    explanation: 'Don\'t move money every time rates change by 0.1%. The hassle isn\'t worth it. Only switch if the difference is 0.5%+ AND sustained.',
    whyItMatters: 'Your time has value. Moving $10,000 for an extra 0.1% = $10/year. Not worth the paperwork.',
    difficulty: 'intermediate',
  },
  {
    id: 'hysa_5',
    category: 'hysa',
    headline: 'Use savings buckets for mental accounting',
    explanation: 'Ally and Capital One let you create separate "buckets" within one account. Label them: Emergency, Travel, Tuition, etc.',
    whyItMatters: 'Seeing "$3,000 emergency fund" vs just "$3,000" makes you less likely to dip into it.',
    difficulty: 'beginner',
  },
  {
    id: 'hysa_6',
    category: 'hysa',
    headline: 'CD laddering for higher locked-in rates',
    explanation: 'Split your savings into 3-12 month CDs that mature at different times. You get higher rates while maintaining some liquidity.',
    whyItMatters: 'If rates drop, you\'re locked into the higher rate. If rates rise, you reinvest the maturing CD higher.',
    difficulty: 'advanced',
  },
];

// ============================================
// ROTH IRA TIPS
// ============================================
export const ROTH_IRA_TIPS: ProTip[] = [
  {
    id: 'roth_1',
    category: 'roth_ira',
    headline: 'F-1 students: 5-year rule matters',
    explanation: 'You\'re a "non-resident alien" for tax purposes until you pass the Substantial Presence Test (usually after 5 calendar years in the US). NRAs generally can\'t contribute to IRAs.',
    whyItMatters: 'Don\'t open a Roth IRA too early. Wait until you\'re a resident for tax purposes, or you could face penalties.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'roth_2',
    category: 'roth_ira',
    headline: 'OPT/H-1B holders: You\'re likely eligible',
    explanation: 'If you\'re working on OPT (post 5 years) or H-1B, you probably pass the Substantial Presence Test and can contribute.',
    whyItMatters: 'Don\'t miss years of tax-free growth just because you\'re unsure. Check with a tax professional if needed.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'roth_3',
    category: 'roth_ira',
    headline: 'Contribute early in the year',
    explanation: 'You can contribute for 2024 from Jan 1, 2024 to April 15, 2025. Contributing in January gives your money 15 extra months to grow.',
    whyItMatters: 'Over 30 years, contributing in January vs December can mean tens of thousands more due to compounding.',
    difficulty: 'beginner',
  },
  {
    id: 'roth_4',
    category: 'roth_ira',
    headline: 'Backdoor Roth for high earners',
    explanation: 'If income exceeds Roth limits (~$161K), contribute to Traditional IRA then convert to Roth. Legal loophole used by millions.',
    whyItMatters: 'Tech workers on H-1B often exceed income limits quickly. Backdoor Roth keeps you in the game.',
    difficulty: 'advanced',
  },
  {
    id: 'roth_5',
    category: 'roth_ira',
    headline: 'Target date funds are fine',
    explanation: 'Vanguard Target Retirement 2060 or Fidelity Freedom 2060 are perfectly good "set it and forget it" options. ~0.10-0.15% expense ratio.',
    whyItMatters: 'Don\'t let analysis paralysis stop you from starting. A target date fund beats not investing at all.',
    difficulty: 'beginner',
  },
  {
    id: 'roth_6',
    category: 'roth_ira',
    headline: 'Three-fund portfolio beats most strategies',
    explanation: 'US Total Market (VTI) + International (VXUS) + Bonds (BND). Classic Bogleheads approach. Adjust ratio based on age/risk.',
    whyItMatters: 'Simple, cheap, diversified. Outperforms 80% of actively managed funds over 20 years.',
    difficulty: 'intermediate',
  },
  {
    id: 'roth_7',
    category: 'roth_ira',
    headline: 'You can withdraw contributions anytime',
    explanation: 'Roth IRA contributions (not earnings) can be withdrawn tax and penalty-free anytime. It\'s not as locked up as people think.',
    whyItMatters: 'This is a psychological benefit. You\'re more likely to contribute knowing you have emergency access.',
    difficulty: 'beginner',
  },
  {
    id: 'roth_8',
    category: 'roth_ira',
    headline: 'Max it every year if possible',
    explanation: '$7,000/year (2024). If you can\'t max it, contribute what you can. Even $100/month = $1,200/year.',
    whyItMatters: 'You can\'t make up missed years. The contribution limit is "use it or lose it" each year.',
    difficulty: 'beginner',
  },
];

// ============================================
// 401(K) TIPS
// ============================================
export const FOUR01K_TIPS: ProTip[] = [
  {
    id: '401k_1',
    category: '401k',
    headline: 'Always get the full employer match',
    explanation: 'If your employer matches 50% up to 6% of salary, contribute at least 6%. That\'s an instant 50% return on your money.',
    whyItMatters: 'Not contributing enough for full match = literally leaving free money on the table.',
    difficulty: 'beginner',
  },
  {
    id: '401k_2',
    category: '401k',
    headline: 'Understand your vesting schedule',
    explanation: 'Employer matches often vest over 3-4 years. If you leave before fully vested, you forfeit unvested amounts.',
    whyItMatters: 'On a visa, job changes are common. Know what you\'ll actually keep if you leave.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: '401k_3',
    category: '401k',
    headline: 'Roth 401(k) vs Traditional 401(k)',
    explanation: 'Traditional: tax deduction now, pay taxes later. Roth: pay taxes now, withdrawals are tax-free. Young + low tax bracket = Roth often better.',
    whyItMatters: 'If you expect higher income later (likely for international students on career track), Roth might save more long-term.',
    difficulty: 'intermediate',
  },
  {
    id: '401k_4',
    category: '401k',
    headline: 'Mega Backdoor Roth for high earners',
    explanation: 'Some 401(k) plans allow after-tax contributions above the $23K limit, then in-plan conversion to Roth. Can add $46K+ extra per year.',
    whyItMatters: 'Tech companies often offer this. It\'s the ultimate tax-advantaged savings hack.',
    difficulty: 'advanced',
  },
  {
    id: '401k_5',
    category: '401k',
    headline: 'Roll over when you leave a job',
    explanation: 'Roll your old 401(k) to an IRA or new employer\'s 401(k). Don\'t cash out (huge tax penalty). Don\'t leave it in limbo.',
    whyItMatters: 'Many international students change jobs. Don\'t lose track of retirement accounts.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: '401k_6',
    category: '401k',
    headline: 'Check for low-cost index fund options',
    explanation: 'Many 401(k)s have at least one low-cost S&P 500 or Total Market index fund. Find it and use it.',
    whyItMatters: 'High expense ratios (1%+) eat into returns significantly over time. Even 0.5% difference matters.',
    difficulty: 'intermediate',
  },
  {
    id: '401k_7',
    category: '401k',
    headline: '401(k) loans are sometimes okay',
    explanation: 'Borrowing from your 401(k) charges you interest that goes back to yourself. Can be better than high-interest debt.',
    whyItMatters: 'Not ideal, but better than credit card debt at 20%+ APR. Know your options.',
    difficulty: 'advanced',
  },
];

// ============================================
// HSA TIPS
// ============================================
export const HSA_TIPS: ProTip[] = [
  {
    id: 'hsa_1',
    category: 'hsa',
    headline: 'HSA is the most tax-advantaged account',
    explanation: 'Triple tax benefit: contributions are tax-deductible, growth is tax-free, withdrawals for medical are tax-free. No other account has all three.',
    whyItMatters: 'If you have access to an HSA, prioritize it even over Roth IRA for the tax benefits.',
    difficulty: 'intermediate',
  },
  {
    id: 'hsa_2',
    category: 'hsa',
    headline: 'You need an HDHP to contribute',
    explanation: 'High Deductible Health Plan: 2024 minimum deductible is $1,600 (individual) or $3,200 (family). Check if your plan qualifies.',
    whyItMatters: 'Many employer plans qualify. Even student health insurance sometimes does. Check before assuming you can\'t.',
    difficulty: 'beginner',
  },
  {
    id: 'hsa_3',
    category: 'hsa',
    headline: 'Use it as a stealth retirement account',
    explanation: 'Pay medical expenses out of pocket now, keep receipts, invest your HSA, withdraw decades later. Reimbursement has no time limit.',
    whyItMatters: 'This strategy turns HSA into a super Roth IRA. Decades of tax-free growth, then tax-free withdrawals.',
    difficulty: 'advanced',
  },
  {
    id: 'hsa_4',
    category: 'hsa',
    headline: 'Invest your HSA balance',
    explanation: 'Most HSAs let you invest once you hit a threshold (often $1,000). Don\'t leave it in cash earning nothing.',
    whyItMatters: 'Cash HSA at 0% vs invested HSA growing 7%/year = massive difference over time.',
    difficulty: 'intermediate',
  },
  {
    id: 'hsa_5',
    category: 'hsa',
    headline: 'HSA is yours forever',
    explanation: 'Unlike FSA (use it or lose it), HSA balance carries over year to year and stays with you if you change jobs.',
    whyItMatters: 'Build it up over time. It\'s a portable, permanent asset you control.',
    difficulty: 'beginner',
  },
  {
    id: 'hsa_6',
    category: 'hsa',
    headline: 'Fidelity HSA has no fees',
    explanation: 'Fidelity\'s HSA has zero account fees and access to their zero expense ratio funds. Best HSA for investing.',
    whyItMatters: 'Many employer HSAs have fees. Consider moving your balance to Fidelity for better returns.',
    actionLabel: 'Open Fidelity HSA',
    difficulty: 'intermediate',
  },
];

// ============================================
// CREDIT CARD TIPS
// ============================================
export const CREDIT_CARD_TIPS: ProTip[] = [
  {
    id: 'cc_1',
    category: 'credit_cards',
    headline: 'Sign-up bonuses are the real value',
    explanation: 'A $200 bonus for spending $500 in 3 months = 40% return. Normal 2% cashback on that spend = $10. Bonuses >> everyday rewards.',
    whyItMatters: 'Strategic card applications can net $1,000+ per year in bonuses alone.',
    difficulty: 'intermediate',
  },
  {
    id: 'cc_2',
    category: 'credit_cards',
    headline: 'Start with secured card, graduate fast',
    explanation: 'Discover Secured → Discover Chrome after 7-12 months. Capital One Secured upgrades too. Get your deposit back + unsecured credit.',
    whyItMatters: 'Building credit fast matters for apartments, car loans, and better card approvals.',
    difficulty: 'beginner',
  },
  {
    id: 'cc_3',
    category: 'credit_cards',
    headline: 'Category optimization 101',
    explanation: 'Use Amex Gold for groceries (4x), Chase Sapphire for dining (3x), Amazon card for Amazon (5%), and a 2% card for everything else.',
    whyItMatters: 'Going from 1% to 3% average return on $2,000/month spend = extra $480/year.',
    difficulty: 'intermediate',
  },
  {
    id: 'cc_4',
    category: 'credit_cards',
    headline: 'Annual fees can be worth it',
    explanation: 'Chase Sapphire Reserve ($550) includes $300 travel credit + lounge access + 3x on travel/dining. If you travel, it pays for itself.',
    whyItMatters: 'Don\'t dismiss cards with fees automatically. Do the math for your spending patterns.',
    difficulty: 'intermediate',
  },
  {
    id: 'cc_5',
    category: 'credit_cards',
    headline: 'Product change instead of cancel',
    explanation: 'Downgrade annual fee cards to no-fee versions to keep credit history alive. Chase Sapphire → Freedom Unlimited.',
    whyItMatters: 'Closing old cards hurts credit score. Downgrading keeps your history.',
    difficulty: 'intermediate',
  },
  {
    id: 'cc_6',
    category: 'credit_cards',
    headline: 'Hard pulls fall off fast',
    explanation: 'Credit inquiries only affect score for ~12 months and disappear at 24 months. Don\'t be too scared of them.',
    whyItMatters: 'Avoiding all applications "to protect score" often costs you more in missed rewards.',
    difficulty: 'intermediate',
  },
  {
    id: 'cc_7',
    category: 'credit_cards',
    headline: 'Pay statement balance, not current balance',
    explanation: 'Pay the full statement balance by due date. You don\'t need to pay off purchases immediately to build credit.',
    whyItMatters: 'Many newbies think they must pay instantly. Just pay statement balance = no interest + credit building.',
    difficulty: 'beginner',
  },
  {
    id: 'cc_8',
    category: 'credit_cards',
    headline: 'Keep utilization under 30%',
    explanation: 'Credit utilization (balance/limit) is a big score factor. Under 30% is good, under 10% is optimal.',
    whyItMatters: 'High utilization temporarily hurts score. If applying for something, pay down balances first.',
    difficulty: 'beginner',
  },
];

// ============================================
// TAX TIPS
// ============================================
export const TAX_TIPS: ProTip[] = [
  {
    id: 'tax_1',
    category: 'tax',
    headline: 'Tax treaties can save thousands',
    explanation: 'Many countries have tax treaties with the US. India: $5,000 exemption for students. China: $5,000. South Korea: $2,000. Check yours!',
    whyItMatters: 'This is free money many students miss. Treaty benefits are in addition to standard deductions.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'tax_2',
    category: 'tax',
    headline: 'F-1 students are exempt from FICA (first 5 years)',
    explanation: 'Social Security (6.2%) and Medicare (1.45%) taxes = 7.65%. F-1/J-1 students exempt for first 5 calendar years.',
    whyItMatters: 'If employer withholds FICA, you can get it refunded. That\'s 7.65% of your income back!',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'tax_3',
    category: 'tax',
    headline: 'Form 8843 is mandatory even with no income',
    explanation: 'Every F-1/J-1 student must file Form 8843, even if you earned nothing. It\'s a statement of non-residence.',
    whyItMatters: 'Not filing can complicate future visa applications. It takes 5 minutes. Just do it.',
    visaRelevant: true,
    difficulty: 'beginner',
  },
  {
    id: 'tax_4',
    category: 'tax',
    headline: 'State taxes vary wildly',
    explanation: 'Texas, Florida, Washington, Nevada = no state income tax. California = up to 13.3%. This matters for total compensation.',
    whyItMatters: '$100K in Texas keeps ~$7K more than California after state tax. Factor this into job decisions.',
    difficulty: 'intermediate',
  },
  {
    id: 'tax_5',
    category: 'tax',
    headline: 'Tax loss harvesting is free money',
    explanation: 'Sell investments at a loss to offset gains. Up to $3,000 of losses can offset regular income annually.',
    whyItMatters: 'If market drops and you have losses, harvest them. Buy similar (not identical) fund to stay invested.',
    difficulty: 'advanced',
  },
  {
    id: 'tax_6',
    category: 'tax',
    headline: 'FBAR if >$10K in foreign accounts',
    explanation: 'If your foreign bank accounts exceed $10K total at any point, you must file FBAR (FinCEN 114). Separate from tax return.',
    whyItMatters: 'Penalties are severe ($10K+ per violation). Most international students need to file this.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'tax_7',
    category: 'tax',
    headline: 'FATCA Form 8938 for higher amounts',
    explanation: 'If foreign assets exceed $50K (single) or $200K (living abroad), file Form 8938 with tax return.',
    whyItMatters: 'Different from FBAR, different thresholds, different penalties. Know the rules.',
    visaRelevant: true,
    difficulty: 'advanced',
  },
  {
    id: 'tax_8',
    category: 'tax',
    headline: 'Sprintax is best for NRA returns',
    explanation: 'TurboTax doesn\'t support non-resident returns. Sprintax is designed for F-1/J-1 students. Many schools offer free access.',
    whyItMatters: 'Using wrong software = wrong filing = IRS issues. Use the right tool.',
    visaRelevant: true,
    difficulty: 'beginner',
  },
];

// ============================================
// INVESTING TIPS
// ============================================
export const INVESTING_TIPS: ProTip[] = [
  {
    id: 'inv_1',
    category: 'investing',
    headline: 'Time in market beats timing the market',
    explanation: 'Missing the 10 best days in 20 years cuts returns in half. You can\'t predict them. Stay invested.',
    whyItMatters: 'Don\'t try to be clever. Consistent investment beats trying to buy low and sell high.',
    difficulty: 'beginner',
  },
  {
    id: 'inv_2',
    category: 'investing',
    headline: 'Dollar cost averaging reduces anxiety',
    explanation: 'Invest fixed amount monthly regardless of market conditions. You buy more shares when cheap, fewer when expensive.',
    whyItMatters: 'Psychologically easier than lump sum. Mathematically similar returns over long periods.',
    difficulty: 'beginner',
  },
  {
    id: 'inv_3',
    category: 'investing',
    headline: 'Expense ratios compound against you',
    explanation: '1% expense ratio vs 0.03% over 30 years on $100K = $100K+ difference. Index funds (VTI, VOO) are ~0.03%.',
    whyItMatters: 'Actively managed funds rarely beat index funds after fees. Keep costs low.',
    difficulty: 'intermediate',
  },
  {
    id: 'inv_4',
    category: 'investing',
    headline: 'ETFs vs Mutual Funds: Minor differences',
    explanation: 'ETFs trade like stocks, mutual funds at end of day. Both fine for long-term. Some mutual funds have minimums.',
    whyItMatters: 'Don\'t overthink this choice. Both work. Pick based on your brokerage\'s offerings.',
    difficulty: 'intermediate',
  },
  {
    id: 'inv_5',
    category: 'investing',
    headline: 'Avoid PFIC nightmare with foreign funds',
    explanation: 'Holding foreign mutual funds/ETFs triggers PFIC rules: punitive taxation + complex reporting. Avoid foreign funds.',
    whyItMatters: 'International students sometimes buy home country funds. Don\'t. Use US-domiciled funds only.',
    visaRelevant: true,
    difficulty: 'advanced',
  },
  {
    id: 'inv_6',
    category: 'investing',
    headline: 'Asset location matters',
    explanation: 'Put tax-inefficient investments (bonds, REITs) in tax-advantaged accounts. Keep tax-efficient stocks in taxable.',
    whyItMatters: 'Same investments, different accounts = different after-tax returns. Optimize placement.',
    difficulty: 'advanced',
  },
  {
    id: 'inv_7',
    category: 'investing',
    headline: 'International diversification: yes, but US-domiciled',
    explanation: 'VXUS or IXUS for international exposure, but held in US brokerage. Get global diversification without PFIC issues.',
    whyItMatters: 'US stocks are ~60% of world market. Some international exposure reduces risk.',
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'inv_8',
    category: 'investing',
    headline: 'Rebalance annually, not constantly',
    explanation: 'Check allocations once a year. If significantly off target (>5%), rebalance. Otherwise, let it ride.',
    whyItMatters: 'Frequent rebalancing creates taxes and fees. Annual is usually enough.',
    difficulty: 'intermediate',
  },
];

// ============================================
// EMERGENCY FUND TIPS
// ============================================
export const EMERGENCY_FUND_TIPS: ProTip[] = [
  {
    id: 'ef_1',
    category: 'emergency_fund',
    headline: 'Visa holders need 6+ months, not 3',
    explanation: 'If you lose a job on H-1B, you have 60 days grace period. Finding a sponsor AND transferring takes time. Cash buys time.',
    whyItMatters: 'Standard advice is 3-6 months. For visa holders, err toward 6-12 months for safety.',
    visaRelevant: true,
    difficulty: 'beginner',
  },
  {
    id: 'ef_2',
    category: 'emergency_fund',
    headline: 'Keep it in HYSA, not invested',
    explanation: 'Emergency fund needs to be accessible and stable. A 30% market drop is exactly when you might need it.',
    whyItMatters: 'The point is safety, not returns. Accept lower returns for peace of mind.',
    difficulty: 'beginner',
  },
  {
    id: 'ef_3',
    category: 'emergency_fund',
    headline: 'Calculate based on expenses, not income',
    explanation: 'If you spend $3,000/month, 6 months = $18,000. Your income doesn\'t matter; your burn rate does.',
    whyItMatters: 'High income with low expenses = smaller fund needed. Low income with high expenses = larger fund.',
    difficulty: 'beginner',
  },
  {
    id: 'ef_4',
    category: 'emergency_fund',
    headline: 'Include one-way flight home in calculation',
    explanation: 'Worst case scenario: visa issues force return. A last-minute one-way international ticket can be $1,500-3,000.',
    whyItMatters: 'Having "go home" money provides peace of mind and real safety net.',
    visaRelevant: true,
    difficulty: 'beginner',
  },
  {
    id: 'ef_5',
    category: 'emergency_fund',
    headline: 'Use it when appropriate',
    explanation: 'Job loss, medical emergency, car repair = yes. Vacation, new phone, "investment opportunity" = no.',
    whyItMatters: 'Some people hoard it too much. Others raid it too often. Know what qualifies.',
    difficulty: 'beginner',
  },
  {
    id: 'ef_6',
    category: 'emergency_fund',
    headline: 'Replenish immediately after using',
    explanation: 'If you use $2,000 from emergency fund, prioritize rebuilding it before resuming regular investing.',
    whyItMatters: 'The next emergency could happen anytime. Don\'t stay exposed.',
    difficulty: 'beginner',
  },
];

// ============================================
// ORDER OF OPERATIONS
// ============================================
export const ORDER_OF_OPERATIONS: ProTip[] = [
  {
    id: 'order_1',
    category: 'order_of_operations',
    headline: 'Step 1: 401(k) up to employer match',
    explanation: 'If employer matches 50% of 6%, contribute 6%. This is an instant 50% return. Nothing beats free money.',
    whyItMatters: 'Even if you have debt, the guaranteed return of employer match usually beats paying off debt.',
    difficulty: 'beginner',
  },
  {
    id: 'order_2',
    category: 'order_of_operations',
    headline: 'Step 2: Pay off high-interest debt',
    explanation: 'Credit card at 20% APR? Pay it off. Guaranteed 20% return. Keep student loans and car loans (under 7%) for later.',
    whyItMatters: 'Investing while carrying 20% debt is like taking out a loan to invest. Math doesn\'t work.',
    difficulty: 'beginner',
  },
  {
    id: 'order_3',
    category: 'order_of_operations',
    headline: 'Step 3: Build 1-month emergency fund',
    explanation: 'Get $1,000-2,000 as starter emergency fund. Prevents going back into debt for small surprises.',
    whyItMatters: 'A small buffer while you tackle debt keeps you from falling back.',
    difficulty: 'beginner',
  },
  {
    id: 'order_4',
    category: 'order_of_operations',
    headline: 'Step 4: Max HSA (if eligible)',
    explanation: 'HSA beats Roth IRA on tax benefits if you have access. $4,150 limit (2024) for individuals.',
    whyItMatters: 'Triple tax advantage is unique to HSA. Max it before other retirement accounts.',
    difficulty: 'intermediate',
  },
  {
    id: 'order_5',
    category: 'order_of_operations',
    headline: 'Step 5: Max Roth IRA',
    explanation: '$7,000 limit (2024). Tax-free growth for decades. Can withdraw contributions if needed.',
    whyItMatters: 'After HSA, Roth IRA is the best tax-advantaged growth vehicle for young people.',
    difficulty: 'intermediate',
  },
  {
    id: 'order_6',
    category: 'order_of_operations',
    headline: 'Step 6: Build 6-month emergency fund',
    explanation: 'Now that high-interest debt is gone and retirement is started, build full emergency fund.',
    whyItMatters: 'Full buffer before aggressive investing protects your financial stability.',
    difficulty: 'intermediate',
  },
  {
    id: 'order_7',
    category: 'order_of_operations',
    headline: 'Step 7: Max 401(k) beyond match',
    explanation: '$23,000 limit (2024). Tax-deferred growth. Now you\'re getting serious.',
    whyItMatters: 'After easier wins, 401(k) is next best tax-advantaged option.',
    difficulty: 'intermediate',
  },
  {
    id: 'order_8',
    category: 'order_of_operations',
    headline: 'Step 8: Taxable brokerage',
    explanation: 'After maxing all tax-advantaged accounts, invest in regular brokerage. No limits, no tax benefits.',
    whyItMatters: 'This is where wealth really accumulates once you\'ve optimized tax-advantaged space.',
    difficulty: 'advanced',
  },
];

// ============================================
// WARNINGS
// ============================================
export const WARNINGS: ProTip[] = [
  {
    id: 'warn_1',
    category: 'warnings',
    headline: 'Day trading can jeopardize visa status',
    explanation: 'Active trading as primary income source may be considered "unauthorized work" on F-1. Passive investing is fine.',
    whyItMatters: 'ICE has flagged students for this. Long-term buy-and-hold investing is safe. Day trading is risky legally.',
    isWarning: true,
    visaRelevant: true,
    difficulty: 'intermediate',
  },
  {
    id: 'warn_2',
    category: 'warnings',
    headline: 'PFIC rules make foreign funds toxic',
    explanation: 'Holding mutual funds or ETFs domiciled outside US triggers punitive PFIC taxation: often 40%+ effective rate.',
    whyItMatters: 'Never invest in your home country\'s funds while US tax resident. Use US-domiciled funds only.',
    isWarning: true,
    visaRelevant: true,
    difficulty: 'advanced',
  },
  {
    id: 'warn_3',
    category: 'warnings',
    headline: 'Don\'t invest money you need in 5 years',
    explanation: 'Market can drop 30-50% and take years to recover. Money for tuition, visa fees, or near-term needs stays in HYSA.',
    whyItMatters: 'Students often have time-sensitive expenses. Don\'t let a market dip ruin your plans.',
    isWarning: true,
    difficulty: 'beginner',
  },
  {
    id: 'warn_4',
    category: 'warnings',
    headline: 'Pay credit card debt before investing',
    explanation: '20%+ APR debt grows faster than any investment returns. Pay it off completely before putting money in the market.',
    whyItMatters: 'Investing while carrying credit card debt is mathematically guaranteed to lose money.',
    isWarning: true,
    difficulty: 'beginner',
  },
  {
    id: 'warn_5',
    category: 'warnings',
    headline: 'Crypto is speculation, not investment',
    explanation: 'Bitcoin, meme coins, NFTs = gambling. Fine for fun money (1-5% of portfolio), not core strategy.',
    whyItMatters: 'Many students lost significant money in crypto crashes. Don\'t bet your future on speculation.',
    isWarning: true,
    difficulty: 'beginner',
  },
  {
    id: 'warn_6',
    category: 'warnings',
    headline: 'Options trading is not for beginners',
    explanation: 'You can lose more than you invest with options. 90%+ of retail options traders lose money.',
    whyItMatters: 'Ignore the WSB "get rich quick" posts. Index funds are boring but they work.',
    isWarning: true,
    difficulty: 'intermediate',
  },
  {
    id: 'warn_7',
    category: 'warnings',
    headline: 'Beware of "too good to be true" returns',
    explanation: 'Anything promising 20%+ guaranteed returns is a scam. Average market return is ~10% before inflation.',
    whyItMatters: 'International students have been targeted by Ponzi schemes. If it sounds too good, it is.',
    isWarning: true,
    visaRelevant: true,
    difficulty: 'beginner',
  },
  {
    id: 'warn_8',
    category: 'warnings',
    headline: 'Keep liquid cash for visa emergencies',
    explanation: 'Premium processing, expedited appointments, legal fees can hit unexpectedly. Keep $2,000-5,000 easily accessible.',
    whyItMatters: 'Immigration situations can require fast access to significant cash. Be prepared.',
    isWarning: true,
    visaRelevant: true,
    difficulty: 'beginner',
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
  const currentMatchAmount = (salary * (currentContribution / 100)) * (matchPercent / 100);
  const annualLoss = maxMatchAmount - currentMatchAmount;
  const totalLoss = annualLoss * years;

  // With 7% growth compounded
  let withGrowth = 0;
  for (let i = 0; i < years; i++) {
    withGrowth = (withGrowth + annualLoss) * 1.07;
  }

  return { annualLoss, totalLoss, withGrowth: Math.round(withGrowth) };
}

// Roth IRA Compound Growth Calculator
export function calculateRothGrowth(
  annualContribution: number,
  currentAge: number,
  retirementAge: number = 65,
  returnRate: number = 0.07
): { finalBalance: number; totalContributed: number; totalGrowth: number } {
  const years = retirementAge - currentAge;
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

export function getVisaRelevantTips(): ProTip[] {
  return ALL_TIPS.filter(tip => tip.visaRelevant);
}

export function getBeginnerTips(): ProTip[] {
  return ALL_TIPS.filter(tip => tip.difficulty === 'beginner');
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
export const CATEGORY_INFO: Record<TipCategory, { label: string; icon: string; description: string }> = {
  hysa: { label: 'High-Yield Savings', icon: '🏦', description: 'Maximize your savings interest' },
  roth_ira: { label: 'Roth IRA', icon: '📈', description: 'Tax-free retirement growth' },
  '401k': { label: '401(k)', icon: '💼', description: 'Employer retirement plans' },
  hsa: { label: 'HSA', icon: '🏥', description: 'Health savings with tax benefits' },
  credit_cards: { label: 'Credit Cards', icon: '💳', description: 'Build credit & earn rewards' },
  tax: { label: 'Taxes', icon: '📋', description: 'Tax strategies for visa holders' },
  investing: { label: 'Investing', icon: '💹', description: 'Long-term wealth building' },
  emergency_fund: { label: 'Emergency Fund', icon: '🛡️', description: 'Financial safety net' },
  order_of_operations: { label: 'Order of Operations', icon: '📊', description: 'The optimal savings flowchart' },
  warnings: { label: 'Warnings', icon: '⚠️', description: 'Mistakes to avoid' },
};
