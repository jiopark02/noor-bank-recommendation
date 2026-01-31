import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getRecommendations, saveRecommendations, BankRecommendation } from '@/lib/bankRecommendation';

// Mock data for development - US Banks
const MOCK_BANKS_US: BankRecommendation[] = [
  {
    bank: {
      id: 'chase_total_checking',
      bank_name: 'Chase',
      account_type: 'Total Checking',
      monthly_fee: 12,
      monthly_fee_waiver: 'Direct deposit $500+/mo or $1,500 daily balance',
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 3,
      intl_wire_outgoing: 45,
      intl_wire_incoming: 15,
      ssn_required_online: true,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: true,
      has_zelle: true,
      has_mobile_deposit: true,
      savings_apy: 0.01,
      is_nationwide: true,
      is_online_only: false,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 85,
      opening_difficulty: 2,
      digital_experience_score: 90,
      customer_service_score: 80,
      branch_count: 4700,
      atm_count: 16000,
      pros: ['Excellent mobile app', 'Zelle built-in', 'Many branches', 'Easy to waive fee'],
      cons: ['Foreign transaction fee', 'High wire fees'],
      apply_link: 'https://www.chase.com',
    },
    fitScore: 92,
    rank: 1,
    isBestMatch: true,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No SSN Required', description: 'Visit a branch to open without SSN', priority: 95 },
      { type: 'positive', icon: '⚡', title: 'Zelle Included', description: 'Send money instantly to friends', priority: 88 },
      { type: 'positive', icon: '📱', title: 'Excellent Mobile App', description: 'Top-rated banking app', priority: 70 },
    ],
    warnings: [
      { type: 'warning', icon: '💳', title: '3% Foreign Transaction Fee', description: 'Adds fees when using card abroad', priority: 75 },
    ],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: '$12/mo (waivable)', isGood: true },
      accessibility: { value: '4,700 branches', isGood: true },
      features: { value: 'Zelle', isGood: true },
      internationalTransfers: { value: '$45 outgoing', isGood: false },
    },
    categoryPick: {
      category: 'best_overall',
      label: 'Best Overall Match',
      reason: '92% fit score based on your profile',
    },
  },
  {
    bank: {
      id: 'bofa_advantage_banking',
      bank_name: 'Bank of America',
      account_type: 'Advantage Banking',
      monthly_fee: 12,
      monthly_fee_waiver: 'Direct deposit $250+/mo or $1,500 daily balance',
      min_balance: 0,
      min_opening_deposit: 100,
      foreign_transaction_fee: 3,
      intl_wire_outgoing: 45,
      intl_wire_incoming: 16,
      ssn_required_online: true,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: true,
      has_zelle: true,
      has_mobile_deposit: true,
      savings_apy: 0.01,
      is_nationwide: true,
      is_online_only: false,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 80,
      opening_difficulty: 2,
      digital_experience_score: 85,
      customer_service_score: 75,
      branch_count: 3900,
      atm_count: 15000,
      pros: ['Many branches', 'Zelle built-in', 'Student account available'],
      cons: ['Foreign transaction fee', 'High wire fees', 'Opening deposit required'],
      apply_link: 'https://www.bankofamerica.com',
    },
    fitScore: 88,
    rank: 2,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No SSN Required', description: 'Visit a branch to open without SSN', priority: 95 },
      { type: 'positive', icon: '⚡', title: 'Zelle Included', description: 'Send money instantly', priority: 88 },
      { type: 'positive', icon: '🎓', title: 'Student Account', description: 'Special benefits for students', priority: 80 },
    ],
    warnings: [
      { type: 'warning', icon: '💰', title: '$100 Opening Deposit', description: 'Required to open account', priority: 60 },
    ],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: '$12/mo (waivable)', isGood: true },
      accessibility: { value: '3,900 branches', isGood: true },
      features: { value: 'Zelle', isGood: true },
      internationalTransfers: { value: '$45 outgoing', isGood: false },
    },
    categoryPick: {
      category: 'best_branches',
      label: 'Most Branches Nearby',
      reason: 'Many locations near your campus',
    },
  },
  {
    bank: {
      id: 'discover_cashback_checking',
      bank_name: 'Discover',
      account_type: 'Cashback Debit',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 0,
      intl_wire_outgoing: 30,
      intl_wire_incoming: 0,
      ssn_required_online: false,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: false,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 3.75,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: false,
      intl_student_friendly: true,
      intl_student_score: 90,
      opening_difficulty: 1,
      digital_experience_score: 85,
      customer_service_score: 90,
      branch_count: 0,
      atm_count: 60000,
      pros: ['No monthly fee', 'No foreign transaction fee', '1% cashback on purchases', 'Open online without SSN', 'High APY savings'],
      cons: ['No Zelle', 'Online only'],
      apply_link: 'https://www.discover.com',
    },
    fitScore: 85,
    rank: 3,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '💰', title: 'No Monthly Fee', description: 'Free account, no minimum balance', priority: 90 },
      { type: 'positive', icon: '🌍', title: 'No Foreign Transaction Fee', description: 'Use your card abroad for free', priority: 85 },
      { type: 'positive', icon: '✨', title: 'Open Online Without SSN', description: 'No branch visit needed', priority: 95 },
      { type: 'positive', icon: '💵', title: '3.75% APY Savings', description: 'High-yield savings account', priority: 70 },
    ],
    warnings: [
      { type: 'warning', icon: '⚡', title: 'No Zelle', description: 'Use Venmo or Cash App instead', priority: 85 },
    ],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'Online only', isGood: true },
      features: { value: '3.75% APY', isGood: true },
      internationalTransfers: { value: '$30 outgoing', isGood: true },
    },
    categoryPick: {
      category: 'best_no_ssn',
      label: 'Easiest Without SSN',
      reason: 'Open online without SSN or branch visit',
    },
  },
  {
    bank: {
      id: 'sofi_checking',
      bank_name: 'SoFi',
      account_type: 'Checking & Savings',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 0,
      intl_wire_outgoing: 0,
      intl_wire_incoming: 0,
      ssn_required_online: true,
      can_open_without_ssn: false,
      itin_accepted: false,
      requires_in_person_for_no_ssn: false,
      has_zelle: true,
      has_mobile_deposit: true,
      savings_apy: 4.00,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: false,
      intl_student_friendly: true,
      intl_student_score: 75,
      opening_difficulty: 2,
      digital_experience_score: 90,
      customer_service_score: 85,
      branch_count: 0,
      atm_count: 55000,
      pros: ['No fees ever', '4% APY', 'Free international wires', 'Zelle included', 'Excellent app'],
      cons: ['SSN required', 'Online only'],
      apply_link: 'https://www.sofi.com',
    },
    fitScore: 78,
    rank: 4,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '🆓', title: 'Free International Wires', description: 'Send and receive for free', priority: 90 },
      { type: 'positive', icon: '💵', title: '4% APY Savings', description: 'Industry-leading rates', priority: 85 },
      { type: 'positive', icon: '⚡', title: 'Zelle Included', description: 'Instant transfers to friends', priority: 88 },
    ],
    warnings: [
      { type: 'warning', icon: '🚫', title: 'SSN Required', description: 'Need SSN to open account', priority: 100 },
    ],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'Online only', isGood: true },
      features: { value: 'Zelle, 4% APY', isGood: true },
      internationalTransfers: { value: 'Free', isGood: true },
    },
    categoryPick: {
      category: 'best_international',
      label: 'Best for International Transfers',
      reason: 'Free outgoing wires, no foreign transaction fee',
    },
  },
];

// Mock data for development - UK Banks
const MOCK_BANKS_UK: BankRecommendation[] = [
  {
    bank: {
      id: 'monzo_uk',
      bank_name: 'Monzo',
      account_type: 'Personal Account',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 0,
      intl_wire_outgoing: 0,
      intl_wire_incoming: 0,
      ssn_required_online: false,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: false,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 4.16,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 95,
      opening_difficulty: 1,
      digital_experience_score: 95,
      customer_service_score: 85,
      branch_count: 0,
      atm_count: 0,
      pros: ['No NIN required', 'No foreign fees', 'Instant notifications', 'Split bills', 'Savings pots'],
      cons: ['Online only', 'No cheque deposits'],
      apply_link: 'https://monzo.com',
    },
    fitScore: 95,
    rank: 1,
    isBestMatch: true,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No NIN Required', description: 'Open without National Insurance Number', priority: 95 },
      { type: 'positive', icon: '🌍', title: 'No Foreign Fees', description: 'Use abroad without charges', priority: 90 },
      { type: 'positive', icon: '📱', title: 'Best Banking App', description: 'Award-winning mobile experience', priority: 85 },
    ],
    warnings: [],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'Mobile app', isGood: true },
      features: { value: 'Savings pots', isGood: true },
      internationalTransfers: { value: 'Via Wise', isGood: true },
    },
    categoryPick: {
      category: 'best_overall',
      label: 'Best Overall for Students',
      reason: 'Perfect for international students - no NIN needed',
    },
  },
  {
    bank: {
      id: 'revolut_uk',
      bank_name: 'Revolut',
      account_type: 'Standard Account',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 0,
      intl_wire_outgoing: 0,
      intl_wire_incoming: 0,
      ssn_required_online: false,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: false,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 3.49,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 92,
      opening_difficulty: 1,
      digital_experience_score: 92,
      customer_service_score: 80,
      branch_count: 0,
      atm_count: 0,
      pros: ['No NIN required', 'Multi-currency', 'Free international transfers', 'Crypto trading', 'Virtual cards'],
      cons: ['Support can be slow', 'Premium features cost extra'],
      apply_link: 'https://revolut.com',
    },
    fitScore: 92,
    rank: 2,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No NIN Required', description: 'Open with just passport', priority: 95 },
      { type: 'positive', icon: '💱', title: 'Multi-Currency', description: 'Hold 30+ currencies', priority: 90 },
      { type: 'positive', icon: '🆓', title: 'Free Transfers', description: 'Send money internationally for free', priority: 88 },
    ],
    warnings: [],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'Mobile app', isGood: true },
      features: { value: 'Multi-currency', isGood: true },
      internationalTransfers: { value: 'Free', isGood: true },
    },
    categoryPick: {
      category: 'best_international',
      label: 'Best for International Transfers',
      reason: 'Send money home for free in 30+ currencies',
    },
  },
  {
    bank: {
      id: 'starling_uk',
      bank_name: 'Starling Bank',
      account_type: 'Personal Account',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 0,
      intl_wire_outgoing: 0,
      intl_wire_incoming: 0,
      ssn_required_online: false,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: false,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 3.25,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 90,
      opening_difficulty: 1,
      digital_experience_score: 93,
      customer_service_score: 90,
      branch_count: 0,
      atm_count: 0,
      pros: ['No NIN required', 'No fees abroad', 'Savings Spaces', '24/7 support', 'Great app'],
      cons: ['Online only', 'Limited investment options'],
      apply_link: 'https://starlingbank.com',
    },
    fitScore: 90,
    rank: 3,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No NIN Required', description: 'Easy to open for students', priority: 95 },
      { type: 'positive', icon: '💬', title: '24/7 Support', description: 'Help whenever you need it', priority: 85 },
      { type: 'positive', icon: '🏆', title: 'Award Winning', description: 'Multiple best bank awards', priority: 80 },
    ],
    warnings: [],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'Mobile app', isGood: true },
      features: { value: 'Spaces', isGood: true },
      internationalTransfers: { value: 'Via app', isGood: true },
    },
    categoryPick: {
      category: 'best_no_ssn',
      label: 'Easiest to Open',
      reason: 'Quick setup without NIN',
    },
  },
  {
    bank: {
      id: 'barclays_uk',
      bank_name: 'Barclays',
      account_type: 'Student Additions',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 2.75,
      intl_wire_outgoing: 25,
      intl_wire_incoming: 6,
      ssn_required_online: false,
      can_open_without_ssn: false,
      itin_accepted: false,
      requires_in_person_for_no_ssn: true,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 1.0,
      is_nationwide: true,
      is_online_only: false,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 80,
      opening_difficulty: 2,
      digital_experience_score: 85,
      customer_service_score: 80,
      branch_count: 1000,
      atm_count: 3500,
      pros: ['Free 16-25 Railcard', 'Interest-free overdraft', 'Branch network', 'Established bank'],
      cons: ['Foreign transaction fee', 'Need student proof'],
      apply_link: 'https://barclays.co.uk',
    },
    fitScore: 85,
    rank: 4,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '🚂', title: 'Free Railcard', description: '4-year 16-25 Railcard worth £90', priority: 90 },
      { type: 'positive', icon: '🏦', title: 'Branch Access', description: 'In-person help when needed', priority: 80 },
      { type: 'positive', icon: '💳', title: 'Overdraft', description: 'Up to £1,500 interest-free', priority: 75 },
    ],
    warnings: [
      { type: 'warning', icon: '💳', title: 'Foreign Fee', description: '2.75% fee on overseas purchases', priority: 70 },
    ],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: '1,000+ branches', isGood: true },
      features: { value: 'Free Railcard', isGood: true },
      internationalTransfers: { value: '£25', isGood: false },
    },
    categoryPick: {
      category: 'best_branches',
      label: 'Best for Branch Access',
      reason: 'Traditional bank with branches everywhere',
    },
  },
];

// Mock data for development - Canada Banks
const MOCK_BANKS_CA: BankRecommendation[] = [
  {
    bank: {
      id: 'tangerine_ca',
      bank_name: 'Tangerine',
      account_type: 'No-Fee Chequing',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 2.5,
      intl_wire_outgoing: 30,
      intl_wire_incoming: 0,
      ssn_required_online: false,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: false,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 5.0,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 92,
      opening_difficulty: 1,
      digital_experience_score: 88,
      customer_service_score: 85,
      branch_count: 0,
      atm_count: 3500,
      pros: ['No SIN required initially', 'No monthly fees', 'High savings rate', 'Scotiabank ATMs', 'Free Interac'],
      cons: ['Online only', 'Promo rate drops after 5 months'],
      apply_link: 'https://tangerine.ca',
    },
    fitScore: 93,
    rank: 1,
    isBestMatch: true,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No SIN Required Initially', description: 'Open account before getting SIN', priority: 95 },
      { type: 'positive', icon: '💰', title: 'No Monthly Fees', description: 'Free banking forever', priority: 90 },
      { type: 'positive', icon: '💵', title: '5% Promo Rate', description: 'High interest on savings', priority: 85 },
    ],
    warnings: [],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'Scotiabank ATMs', isGood: true },
      features: { value: '5% savings', isGood: true },
      internationalTransfers: { value: '$30', isGood: true },
    },
    categoryPick: {
      category: 'best_overall',
      label: 'Best Overall for Students',
      reason: 'No fees, no SIN required to start',
    },
  },
  {
    bank: {
      id: 'simplii_ca',
      bank_name: 'Simplii Financial',
      account_type: 'No Fee Chequing',
      monthly_fee: 0,
      monthly_fee_waiver: null,
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 2.5,
      intl_wire_outgoing: 30,
      intl_wire_incoming: 0,
      ssn_required_online: false,
      can_open_without_ssn: true,
      itin_accepted: true,
      requires_in_person_for_no_ssn: false,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 5.25,
      is_nationwide: true,
      is_online_only: true,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 90,
      opening_difficulty: 1,
      digital_experience_score: 85,
      customer_service_score: 82,
      branch_count: 0,
      atm_count: 3400,
      pros: ['No SIN required initially', 'No fees', 'CIBC ATM access', 'High savings rate', 'Free Interac'],
      cons: ['Online only', 'Promo rate temporary'],
      apply_link: 'https://simplii.com',
    },
    fitScore: 91,
    rank: 2,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '✨', title: 'No SIN Required', description: 'Open before getting SIN', priority: 95 },
      { type: 'positive', icon: '🏧', title: 'CIBC ATM Access', description: 'Use any CIBC ATM free', priority: 85 },
      { type: 'positive', icon: '💵', title: '5.25% Promo Rate', description: 'Industry-leading savings rate', priority: 88 },
    ],
    warnings: [],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free', isGood: true },
      accessibility: { value: 'CIBC ATMs', isGood: true },
      features: { value: '5.25% savings', isGood: true },
      internationalTransfers: { value: '$30', isGood: true },
    },
    categoryPick: {
      category: 'best_no_ssn',
      label: 'Easiest Without SIN',
      reason: 'Open online without SIN',
    },
  },
  {
    bank: {
      id: 'td_canada',
      bank_name: 'TD Canada Trust',
      account_type: 'Student Chequing',
      monthly_fee: 0,
      monthly_fee_waiver: 'Free for students',
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 2.5,
      intl_wire_outgoing: 30,
      intl_wire_incoming: 17.5,
      ssn_required_online: true,
      can_open_without_ssn: false,
      itin_accepted: false,
      requires_in_person_for_no_ssn: true,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 0.05,
      is_nationwide: true,
      is_online_only: false,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 85,
      opening_difficulty: 2,
      digital_experience_score: 88,
      customer_service_score: 85,
      branch_count: 1100,
      atm_count: 3500,
      pros: ['No monthly fee for students', 'Largest branch network', 'Long hours', 'Free Interac', 'Good app'],
      cons: ['Need study permit', 'Low savings rate'],
      apply_link: 'https://td.com',
    },
    fitScore: 88,
    rank: 3,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '🏦', title: 'Most Branches', description: '1,100+ branches across Canada', priority: 90 },
      { type: 'positive', icon: '🕐', title: 'Long Hours', description: 'Open evenings and weekends', priority: 85 },
      { type: 'positive', icon: '🎓', title: 'Student Account', description: 'Free banking for students', priority: 88 },
    ],
    warnings: [
      { type: 'warning', icon: '📋', title: 'Documents Required', description: 'Study permit and enrollment needed', priority: 70 },
    ],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free for students', isGood: true },
      accessibility: { value: '1,100+ branches', isGood: true },
      features: { value: 'Long hours', isGood: true },
      internationalTransfers: { value: '$30', isGood: true },
    },
    categoryPick: {
      category: 'best_branches',
      label: 'Most Branches',
      reason: 'Largest branch network in Canada',
    },
  },
  {
    bank: {
      id: 'rbc_canada',
      bank_name: 'RBC Royal Bank',
      account_type: 'Student Banking',
      monthly_fee: 0,
      monthly_fee_waiver: 'Free until graduation + 1 year',
      min_balance: 0,
      min_opening_deposit: 0,
      foreign_transaction_fee: 2.5,
      intl_wire_outgoing: 25,
      intl_wire_incoming: 12.5,
      ssn_required_online: true,
      can_open_without_ssn: false,
      itin_accepted: false,
      requires_in_person_for_no_ssn: true,
      has_zelle: false,
      has_mobile_deposit: true,
      savings_apy: 0.02,
      is_nationwide: true,
      is_online_only: false,
      has_student_account: true,
      intl_student_friendly: true,
      intl_student_score: 82,
      opening_difficulty: 2,
      digital_experience_score: 85,
      customer_service_score: 82,
      branch_count: 1000,
      atm_count: 4500,
      pros: ['Free until 1 year after graduation', 'RBC Rewards', 'Good mobile app', 'Wide network'],
      cons: ['Need documents', 'Basic student account'],
      apply_link: 'https://rbc.com',
    },
    fitScore: 85,
    rank: 4,
    isBestMatch: false,
    matchReasons: [
      { type: 'positive', icon: '🎓', title: 'Free After Graduation', description: 'No fees until 1 year after grad', priority: 88 },
      { type: 'positive', icon: '🎁', title: 'RBC Rewards', description: 'Earn points on purchases', priority: 75 },
      { type: 'positive', icon: '🏦', title: 'Branch Network', description: '1,000 branches nationwide', priority: 80 },
    ],
    warnings: [],
    monthlyEstimatedCost: 0,
    yearlyEstimatedCost: 0,
    comparisonHighlights: {
      fees: { value: 'Free for students', isGood: true },
      accessibility: { value: '1,000 branches', isGood: true },
      features: { value: 'RBC Rewards', isGood: true },
      internationalTransfers: { value: '$25', isGood: true },
    },
    categoryPick: {
      category: 'best_student',
      label: 'Best Student Perks',
      reason: 'Free banking continues after graduation',
    },
  },
];

// Get mock banks by country
function getMockBanksByCountry(country: string): BankRecommendation[] {
  switch (country) {
    case 'UK':
      return MOCK_BANKS_UK;
    case 'CA':
      return MOCK_BANKS_CA;
    case 'US':
    default:
      return MOCK_BANKS_US;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '5');
    const country = searchParams.get('country') || 'US';

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Get country-specific mock data
    const mockBanks = getMockBanksByCountry(country);

    const supabase = createServerClient();

    try {
      // Try to get real recommendations
      const recommendations = await getRecommendations(supabase, userId, limit, country);

      // Save to DB (async, ignore errors)
      saveRecommendations(supabase, userId, recommendations).catch(console.error);

      return NextResponse.json({
        success: true,
        data: recommendations,
        meta: {
          total: recommendations.length,
          algorithm_version: 'v2',
          country,
        },
      });
    } catch (dbError) {
      // Fallback to mock data for development
      console.warn('Using mock data for country:', country, dbError);

      return NextResponse.json({
        success: true,
        data: mockBanks.slice(0, limit),
        meta: {
          total: mockBanks.length,
          algorithm_version: 'mock',
          country,
        },
      });
    }
  } catch (error) {
    console.error('Bank recommendation error:', error);

    // Return mock data even on error - use US as fallback
    const country = 'US';
    const mockBanks = getMockBanksByCountry(country);

    return NextResponse.json({
      success: true,
      data: mockBanks.slice(0, 5),
      meta: {
        total: mockBanks.length,
        algorithm_version: 'mock',
        country,
      },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, recommendationId, action, data } = body;

    if (!userId || !recommendationId || !action) {
      return NextResponse.json(
        { error: 'userId, recommendationId, and action are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    switch (action) {
      case 'view':
        await supabase
          .from('recommendations_new')
          .update({ is_viewed: true })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      case 'save':
        await supabase
          .from('recommendations_new')
          .update({ is_saved: true })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      case 'dismiss':
        await supabase
          .from('recommendations_new')
          .update({ is_dismissed: true })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      case 'rate':
        if (!data?.rating) {
          return NextResponse.json(
            { error: 'rating is required for rate action' },
            { status: 400 }
          );
        }
        await supabase
          .from('recommendations_new')
          .update({
            user_rating: data.rating,
            user_feedback: data.feedback || null,
          })
          .eq('id', recommendationId)
          .eq('user_id', userId);
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Recommendation action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
