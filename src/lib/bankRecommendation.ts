/**
 * Noor Bank Recommendation Algorithm v2
 * Professional bank consulting for international students
 * Updated: Jan 2026
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Type Definitions
// ============================================================

export interface UserProfile {
  id: string;
  // Basic Info
  has_ssn: boolean;
  has_itin: boolean;
  has_us_address: boolean;
  university: string | null;

  // Financial Profile
  monthly_income: number;
  monthly_budget: number;
  expected_monthly_spending: number;
  avg_monthly_balance: number;

  // Banking Needs
  international_transfer_frequency: 'never' | 'rarely' | 'monthly' | 'weekly';
  avg_transfer_amount: number;
  needs_zelle: boolean;
  wants_to_build_credit: boolean;

  // Preferences
  fee_sensitivity: 'low' | 'medium' | 'high';
  prefers_online_banking: boolean;
  needs_nearby_branch: boolean;
  preferred_language: string;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  account_type: string;
  monthly_fee: number;
  monthly_fee_waiver: string | null;
  min_balance: number;
  min_opening_deposit: number;
  foreign_transaction_fee: number;
  intl_wire_outgoing: number;
  intl_wire_incoming: number;
  ssn_required_online: boolean;
  can_open_without_ssn: boolean;
  itin_accepted: boolean;
  requires_in_person_for_no_ssn: boolean;
  has_zelle: boolean;
  has_mobile_deposit: boolean;
  savings_apy: number;
  is_nationwide: boolean;
  is_online_only: boolean;
  has_student_account: boolean;
  intl_student_friendly: boolean;
  intl_student_score: number;
  opening_difficulty: number;
  digital_experience_score: number;
  customer_service_score: number;
  branch_count: number;
  atm_count: number;
  pros: string[];
  cons: string[];
  apply_link: string | null;
  no_ssn_note?: string; // Note about opening without SSN/NIN/SIN
}

export interface MatchReason {
  type: 'positive' | 'warning' | 'info';
  icon: string;
  title: string;
  description: string;
  priority: number; // Higher = more important
}

export interface BankRecommendation {
  bank: BankAccount;
  fitScore: number;
  rank: number;
  isBestMatch: boolean;
  matchReasons: MatchReason[];
  warnings: MatchReason[];
  monthlyEstimatedCost: number;
  yearlyEstimatedCost: number;
  comparisonHighlights: {
    fees: { value: string; isGood: boolean };
    accessibility: { value: string; isGood: boolean };
    features: { value: string; isGood: boolean };
    internationalTransfers: { value: string; isGood: boolean };
  };
  // Category pick info (if this bank won a category)
  categoryPick?: CategoryPick;
}

export type CategoryType =
  | 'best_overall'
  | 'best_low_fees'
  | 'best_international'
  | 'best_branches'
  | 'best_online'
  | 'best_student'
  | 'best_no_ssn';

export interface CategoryPick {
  category: CategoryType;
  label: string;
  reason: string;
}

// ============================================================
// University Branch Data
// ============================================================

const UNIVERSITY_BRANCHES: Record<string, Record<string, number>> = {
  'UC Berkeley': {
    'Chase': 5,
    'Bank of America': 4,
    'Wells Fargo': 3,
    'Citibank': 2,
    'TD Bank': 0,
    'Santander': 0,
    'U.S. Bank': 1,
    'Capital One': 1, // Cafe
  },
  'Stanford University': {
    'Chase': 4,
    'Bank of America': 3,
    'Wells Fargo': 4,
    'Citibank': 1,
    'TD Bank': 0,
    'Santander': 0,
    'U.S. Bank': 2,
    'Capital One': 0,
  },
  'UCLA': {
    'Chase': 6,
    'Bank of America': 5,
    'Wells Fargo': 4,
    'Citibank': 2,
    'TD Bank': 0,
    'Santander': 0,
    'U.S. Bank': 3,
    'Capital One': 2,
  },
  'NYU': {
    'Chase': 15,
    'Bank of America': 8,
    'Wells Fargo': 5,
    'Citibank': 10,
    'TD Bank': 12,
    'Santander': 8,
    'U.S. Bank': 0,
    'Capital One': 3,
  },
};

// ============================================================
// Scoring Functions
// ============================================================

function calculateEligibilityScore(user: UserProfile, bank: BankAccount): {
  eligible: boolean;
  score: number;
  reasons: MatchReason[];
} {
  const reasons: MatchReason[] = [];
  let score = 100;

  // SSN Check - Critical
  if (!user.has_ssn) {
    if (!bank.can_open_without_ssn) {
      return {
        eligible: false,
        score: 0,
        reasons: [{
          type: 'warning',
          icon: '🚫',
          title: 'SSN Required',
          description: `${bank.bank_name} requires SSN for account opening. You cannot open this account without SSN.`,
          priority: 100,
        }],
      };
    }

    if (bank.requires_in_person_for_no_ssn) {
      reasons.push({
        type: 'info',
        icon: '🏦',
        title: 'Branch Visit Required',
        description: 'Without SSN, you need to visit a branch in person to open this account.',
        priority: 70,
      });
      score -= 10;
    } else {
      reasons.push({
        type: 'positive',
        icon: '✨',
        title: 'No SSN Required',
        description: 'You can open this account without SSN - perfect for new international students.',
        priority: 95,
      });
    }
  }

  // ITIN Check
  if (!user.has_ssn && user.has_itin) {
    if (bank.itin_accepted) {
      reasons.push({
        type: 'positive',
        icon: '✓',
        title: 'ITIN Accepted',
        description: 'Your ITIN will work for opening this account.',
        priority: 85,
      });
    }
  }

  return { eligible: true, score, reasons };
}

function calculateFeeScore(user: UserProfile, bank: BankAccount): {
  score: number;
  monthlyCost: number;
  reasons: MatchReason[];
  warnings: MatchReason[];
} {
  const reasons: MatchReason[] = [];
  const warnings: MatchReason[] = [];
  let score = 100;
  let monthlyCost = 0;

  // Monthly Fee Analysis
  if (bank.monthly_fee === 0) {
    reasons.push({
      type: 'positive',
      icon: '💰',
      title: 'No Monthly Fee',
      description: 'This account has no monthly maintenance fee - ever.',
      priority: 90,
    });
  } else {
    if (bank.monthly_fee_waiver) {
      // Check if user can meet waiver requirements
      const waiverLower = bank.monthly_fee_waiver.toLowerCase();
      const canMeetWaiver =
        waiverLower.includes('student') ||
        waiverLower.includes('direct deposit') ||
        (waiverLower.includes('$500') && user.avg_monthly_balance >= 500) ||
        (waiverLower.includes('$1,500') && user.avg_monthly_balance >= 1500);

      if (canMeetWaiver) {
        reasons.push({
          type: 'positive',
          icon: '✓',
          title: 'Fee Waivable',
          description: `$${bank.monthly_fee}/month fee waived: ${bank.monthly_fee_waiver}`,
          priority: 80,
        });
      } else {
        warnings.push({
          type: 'warning',
          icon: '⚠️',
          title: 'Monthly Fee Applies',
          description: `$${bank.monthly_fee}/month fee. Waiver requires: ${bank.monthly_fee_waiver}`,
          priority: 85,
        });
        monthlyCost += bank.monthly_fee;
        score -= 20;
      }
    } else {
      warnings.push({
        type: 'warning',
        icon: '💸',
        title: 'Unavoidable Monthly Fee',
        description: `$${bank.monthly_fee}/month fee cannot be waived.`,
        priority: 90,
      });
      monthlyCost += bank.monthly_fee;
      score -= 30;
    }
  }

  // Minimum Balance Check
  if (bank.min_balance > 0) {
    if (user.avg_monthly_balance < bank.min_balance) {
      warnings.push({
        type: 'warning',
        icon: '📊',
        title: 'Minimum Balance Required',
        description: `Requires $${bank.min_balance.toLocaleString()} minimum balance. Your average is $${user.avg_monthly_balance.toLocaleString()}.`,
        priority: 80,
      });
      score -= 15;
    }
  } else {
    reasons.push({
      type: 'positive',
      icon: '✓',
      title: 'No Minimum Balance',
      description: 'No minimum balance requirement.',
      priority: 70,
    });
  }

  // Opening Deposit
  if (bank.min_opening_deposit === 0) {
    reasons.push({
      type: 'positive',
      icon: '✓',
      title: 'No Opening Deposit',
      description: 'Open with $0 - no initial deposit required.',
      priority: 65,
    });
  } else if (bank.min_opening_deposit > 50) {
    warnings.push({
      type: 'info',
      icon: 'ℹ️',
      title: 'Opening Deposit Required',
      description: `$${bank.min_opening_deposit} minimum opening deposit required.`,
      priority: 50,
    });
  }

  // Fee sensitivity adjustment
  if (user.fee_sensitivity === 'high') {
    score = score * 1.2; // Boost importance of fee score
  }

  return { score: Math.min(100, score), monthlyCost, reasons, warnings };
}

function calculateTransferScore(user: UserProfile, bank: BankAccount): {
  score: number;
  monthlyCost: number;
  reasons: MatchReason[];
  warnings: MatchReason[];
} {
  const reasons: MatchReason[] = [];
  const warnings: MatchReason[] = [];
  let score = 100;
  let monthlyCost = 0;

  // Skip if user doesn't do international transfers
  if (user.international_transfer_frequency === 'never') {
    return { score: 100, monthlyCost: 0, reasons: [], warnings: [] };
  }

  const transfersPerMonth = {
    'rarely': 0.25,
    'monthly': 1,
    'weekly': 4,
  }[user.international_transfer_frequency] || 1;

  // Foreign Transaction Fee
  if (bank.foreign_transaction_fee === 0) {
    reasons.push({
      type: 'positive',
      icon: '🌍',
      title: 'No Foreign Transaction Fee',
      description: 'Use your debit card abroad without extra fees.',
      priority: 85,
    });
  } else {
    const estimatedFTF = user.expected_monthly_spending * 0.1 * (bank.foreign_transaction_fee / 100);
    warnings.push({
      type: 'warning',
      icon: '💳',
      title: `${bank.foreign_transaction_fee}% Foreign Transaction Fee`,
      description: `Adds ~$${estimatedFTF.toFixed(0)}/month if using card internationally.`,
      priority: 75,
    });
    monthlyCost += estimatedFTF;
    score -= 15;
  }

  // Wire Transfer Fees
  if (bank.intl_wire_outgoing === 0 && bank.intl_wire_incoming === 0) {
    reasons.push({
      type: 'positive',
      icon: '🆓',
      title: 'Free International Wires',
      description: 'Send and receive international wire transfers for free.',
      priority: 90,
    });
  } else {
    const monthlyWireCost = (bank.intl_wire_outgoing + bank.intl_wire_incoming) * transfersPerMonth;

    if (bank.intl_wire_outgoing > 30) {
      warnings.push({
        type: 'warning',
        icon: '📤',
        title: `$${bank.intl_wire_outgoing} Outgoing Wire Fee`,
        description: user.international_transfer_frequency === 'weekly'
          ? `At your transfer frequency, this costs ~$${(bank.intl_wire_outgoing * 4).toFixed(0)}/month.`
          : `Consider using Wise or Remitly for cheaper transfers.`,
        priority: 80,
      });
      score -= 20;
    }

    if (bank.intl_wire_incoming > 0) {
      warnings.push({
        type: 'info',
        icon: '📥',
        title: `$${bank.intl_wire_incoming} Incoming Wire Fee`,
        description: 'Fee charged when receiving money from abroad.',
        priority: 60,
      });
      score -= 10;
    }

    monthlyCost += monthlyWireCost;
  }

  // Recommend Wise/Remitly for frequent transfers
  if (user.international_transfer_frequency === 'weekly' && bank.intl_wire_outgoing > 20) {
    reasons.push({
      type: 'info',
      icon: '💡',
      title: 'Pro Tip: Use Wise for Transfers',
      description: 'For your frequent transfers, pair this account with Wise or Remitly for lower fees.',
      priority: 70,
    });
  }

  return { score: Math.max(0, score), monthlyCost, reasons, warnings };
}

function calculateAccessibilityScore(user: UserProfile, bank: BankAccount): {
  score: number;
  reasons: MatchReason[];
  warnings: MatchReason[];
} {
  const reasons: MatchReason[] = [];
  const warnings: MatchReason[] = [];
  let score = 70;

  // Branch Proximity
  const universityBranches = UNIVERSITY_BRANCHES[user.university || ''] || {};
  const nearbyBranches = universityBranches[bank.bank_name] || 0;

  if (user.needs_nearby_branch) {
    if (nearbyBranches >= 3) {
      reasons.push({
        type: 'positive',
        icon: '📍',
        title: `${nearbyBranches} Branches Near ${user.university}`,
        description: 'Multiple convenient branch locations near your campus.',
        priority: 90,
      });
      score += 25;
    } else if (nearbyBranches > 0) {
      reasons.push({
        type: 'info',
        icon: '📍',
        title: `${nearbyBranches} Branch Near ${user.university}`,
        description: 'Limited branch access near campus.',
        priority: 70,
      });
      score += 10;
    } else if (bank.is_online_only) {
      warnings.push({
        type: 'warning',
        icon: '🏦',
        title: 'Online Only - No Branches',
        description: 'This bank has no physical branches. You need a branch for in-person services.',
        priority: 85,
      });
      score -= 30;
    } else {
      warnings.push({
        type: 'warning',
        icon: '📍',
        title: 'No Branches Near Campus',
        description: `${bank.bank_name} has no branches near ${user.university}.`,
        priority: 75,
      });
      score -= 20;
    }
  } else {
    // User prefers online banking
    if (bank.is_online_only) {
      reasons.push({
        type: 'positive',
        icon: '💻',
        title: '100% Online Banking',
        description: 'Fully digital experience - manage everything from your phone.',
        priority: 80,
      });
      score += 15;
    }
  }

  // Mobile App Quality
  if (bank.digital_experience_score >= 85) {
    reasons.push({
      type: 'positive',
      icon: '📱',
      title: 'Excellent Mobile App',
      description: 'Top-rated mobile banking app with modern features.',
      priority: 70,
    });
    score += 10;
  }

  // ATM Network
  if (bank.atm_count >= 50000) {
    reasons.push({
      type: 'positive',
      icon: '🏧',
      title: `${(bank.atm_count / 1000).toFixed(0)}K+ Free ATMs`,
      description: 'Large ATM network means easy cash access anywhere.',
      priority: 65,
    });
  }

  return { score: Math.min(100, Math.max(0, score)), reasons, warnings };
}

function calculateFeatureScore(user: UserProfile, bank: BankAccount): {
  score: number;
  reasons: MatchReason[];
  warnings: MatchReason[];
} {
  const reasons: MatchReason[] = [];
  const warnings: MatchReason[] = [];
  let score = 50;

  // Zelle
  if (user.needs_zelle) {
    if (bank.has_zelle) {
      reasons.push({
        type: 'positive',
        icon: '⚡',
        title: 'Zelle Included',
        description: 'Send money instantly to friends and pay rent easily.',
        priority: 88,
      });
      score += 25;
    } else {
      warnings.push({
        type: 'warning',
        icon: '⚡',
        title: 'No Zelle',
        description: 'Zelle is not available with this bank. Consider another option if you need instant transfers.',
        priority: 85,
      });
      score -= 20;
    }
  }

  // Credit Building
  if (user.wants_to_build_credit) {
    if (bank.has_student_account && bank.bank_name !== 'Discover') {
      reasons.push({
        type: 'info',
        icon: '📈',
        title: 'Credit Building Path',
        description: `${bank.bank_name} offers credit cards you can upgrade to after building banking relationship.`,
        priority: 75,
      });
      score += 10;
    }
  }

  // Savings APY
  if (bank.savings_apy >= 3.5) {
    reasons.push({
      type: 'positive',
      icon: '💵',
      title: `${bank.savings_apy}% APY Savings`,
      description: 'High-yield savings account available.',
      priority: 70,
    });
    score += 15;
  }

  // International Student Friendly
  if (bank.intl_student_friendly) {
    reasons.push({
      type: 'positive',
      icon: '🎓',
      title: 'International Student Friendly',
      description: 'This bank is known for welcoming international students.',
      priority: 80,
    });
    score += 15;
  }

  // Mobile Deposit
  if (bank.has_mobile_deposit) {
    reasons.push({
      type: 'positive',
      icon: '📸',
      title: 'Mobile Check Deposit',
      description: 'Deposit checks by taking a photo - no branch visit needed.',
      priority: 60,
    });
  }

  return { score: Math.min(100, score), reasons, warnings };
}

// ============================================================
// Main Recommendation Function
// ============================================================

function generateRecommendation(user: UserProfile, bank: BankAccount): BankRecommendation | null {
  // Step 1: Check eligibility
  const eligibility = calculateEligibilityScore(user, bank);
  if (!eligibility.eligible) {
    return null;
  }

  // Step 2: Calculate all scores
  const feeResult = calculateFeeScore(user, bank);
  const transferResult = calculateTransferScore(user, bank);
  const accessResult = calculateAccessibilityScore(user, bank);
  const featureResult = calculateFeatureScore(user, bank);

  // Step 3: Calculate weighted final score
  const weights = {
    eligibility: 0.15,
    fees: user.fee_sensitivity === 'high' ? 0.30 : 0.20,
    transfers: user.international_transfer_frequency !== 'never' ? 0.20 : 0.05,
    accessibility: user.needs_nearby_branch ? 0.25 : 0.15,
    features: 0.20,
  };

  // Normalize weights
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const normalizedWeights = Object.fromEntries(
    Object.entries(weights).map(([k, v]) => [k, v / totalWeight])
  );

  const fitScore =
    eligibility.score * normalizedWeights.eligibility +
    feeResult.score * normalizedWeights.fees +
    transferResult.score * normalizedWeights.transfers +
    accessResult.score * normalizedWeights.accessibility +
    featureResult.score * normalizedWeights.features;

  // Step 4: Combine and prioritize reasons
  const allReasons = [
    ...eligibility.reasons,
    ...feeResult.reasons,
    ...transferResult.reasons,
    ...accessResult.reasons,
    ...featureResult.reasons,
  ].filter(r => r.type === 'positive' || r.type === 'info')
   .sort((a, b) => b.priority - a.priority)
   .slice(0, 6);

  const allWarnings = [
    ...feeResult.warnings,
    ...transferResult.warnings,
    ...accessResult.warnings,
    ...featureResult.warnings,
  ].sort((a, b) => b.priority - a.priority)
   .slice(0, 4);

  // Step 5: Calculate costs
  const monthlyEstimatedCost = feeResult.monthlyCost + transferResult.monthlyCost;

  // Step 6: Generate comparison highlights
  const comparisonHighlights = {
    fees: {
      value: bank.monthly_fee === 0 ? 'Free' : `$${bank.monthly_fee}/mo`,
      isGood: bank.monthly_fee === 0 || feeResult.score >= 80,
    },
    accessibility: {
      value: bank.is_online_only ? 'Online only' : `${bank.branch_count.toLocaleString()} branches`,
      isGood: accessResult.score >= 70,
    },
    features: {
      value: [
        bank.has_zelle ? 'Zelle' : '',
        bank.savings_apy >= 3 ? `${bank.savings_apy}% APY` : '',
      ].filter(Boolean).join(', ') || 'Basic',
      isGood: featureResult.score >= 60,
    },
    internationalTransfers: {
      value: bank.intl_wire_outgoing === 0 ? 'Free' : `$${bank.intl_wire_outgoing} outgoing`,
      isGood: bank.intl_wire_outgoing <= 20 && bank.foreign_transaction_fee === 0,
    },
  };

  return {
    bank,
    fitScore: Math.round(fitScore),
    rank: 0, // Will be set later
    isBestMatch: false, // Will be set later
    matchReasons: allReasons,
    warnings: allWarnings,
    monthlyEstimatedCost,
    yearlyEstimatedCost: monthlyEstimatedCost * 12,
    comparisonHighlights,
  };
}

// ============================================================
// Exports
// ============================================================

export async function getRecommendations(
  supabase: SupabaseClient,
  userId: string,
  limit: number = 5,
  country: string = 'US'
): Promise<BankRecommendation[]> {
  // 1. Fetch user
  const { data: dbUser, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !dbUser) {
    throw new Error(`User not found: ${userError?.message}`);
  }

  // 2. Map DB user to UserProfile
  const user = mapDbUserToProfile(dbUser);

  // 3. Fetch banks - filter by country
  let banksQuery = supabase.from('bank_accounts').select('*');

  // Filter by country if the column exists
  if (country && country !== 'US') {
    banksQuery = banksQuery.eq('country', country);
  } else if (country === 'US') {
    // For US, get banks that are either US or have no country specified (backwards compatibility)
    banksQuery = banksQuery.or('country.eq.US,country.is.null');
  }

  const { data: banks, error: banksError } = await banksQuery;

  if (banksError || !banks) {
    throw new Error(`Bank accounts not found: ${banksError?.message}`);
  }

  // 4. Generate recommendations (with deduplication by bank_name)
  const recommendationsByBank = new Map<string, BankRecommendation>();

  for (const bank of banks) {
    const bankAccount = mapDbBankToAccount(bank);
    const recommendation = generateRecommendation(user, bankAccount);
    if (recommendation) {
      const existingRec = recommendationsByBank.get(bankAccount.bank_name);
      // Keep the one with higher fit score if duplicate
      if (!existingRec || recommendation.fitScore > existingRec.fitScore) {
        recommendationsByBank.set(bankAccount.bank_name, recommendation);
      }
    }
  }

  // Convert to array and sort
  const recommendations = Array.from(recommendationsByBank.values());
  recommendations.sort((a, b) => b.fitScore - a.fitScore);

  // 5. Assign ranks
  recommendations.forEach((rec, index) => {
    rec.rank = index + 1;
    rec.isBestMatch = index === 0;
  });

  // 6. Assign category picks (each category gets a DIFFERENT bank)
  assignCategoryPicks(recommendations, user);

  // 7. Return top N
  return recommendations.slice(0, limit);
}

// ============================================================
// Category Pick Assignment
// ============================================================

function assignCategoryPicks(recommendations: BankRecommendation[], user: UserProfile): void {
  const usedBankNames = new Set<string>();

  // Helper to find best bank for a category that hasn't been used
  const findBestForCategory = (
    scoreFn: (rec: BankRecommendation) => number,
    filterFn?: (rec: BankRecommendation) => boolean
  ): BankRecommendation | null => {
    const candidates = recommendations
      .filter(rec => !usedBankNames.has(rec.bank.bank_name))
      .filter(rec => filterFn ? filterFn(rec) : true)
      .sort((a, b) => scoreFn(b) - scoreFn(a));
    return candidates[0] || null;
  };

  // 1. Best Overall - highest fit score
  const bestOverall = recommendations[0];
  if (bestOverall) {
    bestOverall.categoryPick = {
      category: 'best_overall',
      label: 'Best Overall Match',
      reason: `${bestOverall.fitScore}% fit score based on your profile`,
    };
    usedBankNames.add(bestOverall.bank.bank_name);
  }

  // 2. Best for Low Fees - lowest total cost
  const bestLowFees = findBestForCategory(
    (rec) => -rec.monthlyEstimatedCost - rec.bank.monthly_fee,
    (rec) => rec.bank.monthly_fee === 0 || rec.monthlyEstimatedCost < 5
  );
  if (bestLowFees) {
    bestLowFees.categoryPick = {
      category: 'best_low_fees',
      label: 'Best for Low Fees',
      reason: bestLowFees.bank.monthly_fee === 0
        ? 'No monthly fees, no minimum balance'
        : `Only $${bestLowFees.bank.monthly_fee}/month, easily waivable`,
    };
    usedBankNames.add(bestLowFees.bank.bank_name);
  }

  // 3. Best for International Transfers - lowest wire fees
  const bestIntl = findBestForCategory(
    (rec) => -(rec.bank.intl_wire_outgoing + rec.bank.foreign_transaction_fee * 10),
    (rec) => rec.bank.intl_wire_outgoing <= 25 || rec.bank.foreign_transaction_fee === 0
  );
  if (bestIntl) {
    const reasons: string[] = [];
    if (bestIntl.bank.intl_wire_outgoing === 0) reasons.push('free outgoing wires');
    else if (bestIntl.bank.intl_wire_outgoing <= 15) reasons.push(`only $${bestIntl.bank.intl_wire_outgoing} wire fee`);
    if (bestIntl.bank.foreign_transaction_fee === 0) reasons.push('no foreign transaction fee');

    bestIntl.categoryPick = {
      category: 'best_international',
      label: 'Best for International Transfers',
      reason: reasons.length > 0 ? reasons.join(', ') : 'Low international transfer costs',
    };
    usedBankNames.add(bestIntl.bank.bank_name);
  }

  // 4. Best for Branches - most branches near university
  const universityBranches = UNIVERSITY_BRANCHES[user.university || ''] || {};
  const bestBranches = findBestForCategory(
    (rec) => universityBranches[rec.bank.bank_name] || 0,
    (rec) => (universityBranches[rec.bank.bank_name] || 0) >= 2
  );
  if (bestBranches) {
    const branchCount = universityBranches[bestBranches.bank.bank_name] || 0;
    bestBranches.categoryPick = {
      category: 'best_branches',
      label: 'Most Branches Nearby',
      reason: `${branchCount} locations near ${user.university || 'your campus'}`,
    };
    usedBankNames.add(bestBranches.bank.bank_name);
  }

  // 5. Best Online Option - for digital-first users
  const bestOnline = findBestForCategory(
    (rec) => rec.bank.digital_experience_score + (rec.bank.is_online_only ? 20 : 0),
    (rec) => rec.bank.is_online_only || rec.bank.digital_experience_score >= 80
  );
  if (bestOnline) {
    bestOnline.categoryPick = {
      category: 'best_online',
      label: 'Best Online Option',
      reason: bestOnline.bank.is_online_only
        ? '100% digital, excellent mobile app'
        : 'Top-rated mobile banking experience',
    };
    usedBankNames.add(bestOnline.bank.bank_name);
  }

  // 6. Best for Students
  const bestStudent = findBestForCategory(
    (rec) => rec.bank.intl_student_score + (rec.bank.has_student_account ? 20 : 0),
    (rec) => rec.bank.has_student_account || rec.bank.intl_student_friendly
  );
  if (bestStudent) {
    bestStudent.categoryPick = {
      category: 'best_student',
      label: 'Best for Students',
      reason: bestStudent.bank.intl_student_friendly
        ? 'Designed for international students'
        : 'Special student account benefits',
    };
    usedBankNames.add(bestStudent.bank.bank_name);
  }

  // 7. Best No SSN Option (if user doesn't have SSN)
  if (!user.has_ssn) {
    const bestNoSsn = findBestForCategory(
      (rec) => rec.fitScore + (rec.bank.requires_in_person_for_no_ssn ? 0 : 20),
      (rec) => rec.bank.can_open_without_ssn && !rec.bank.requires_in_person_for_no_ssn
    );
    if (bestNoSsn) {
      bestNoSsn.categoryPick = {
        category: 'best_no_ssn',
        label: 'Easiest Without SSN',
        reason: 'Open online without SSN or branch visit',
      };
      usedBankNames.add(bestNoSsn.bank.bank_name);
    }
  }
}

export async function saveRecommendations(
  supabase: SupabaseClient,
  userId: string,
  recommendations: BankRecommendation[]
): Promise<void> {
  try {
    const records = recommendations.map((rec) => ({
      user_id: userId,
      recommendation_type: 'bank',
      bank_account_id: rec.bank.id,
      fit_score: rec.fitScore,
      score_breakdown: {
        matchReasons: rec.matchReasons,
        warnings: rec.warnings,
        comparisonHighlights: rec.comparisonHighlights,
      },
      reasons: rec.matchReasons.map(r => r.title),
      warnings: rec.warnings.map(w => w.title),
      algorithm_version: 'v2',
    }));

    await supabase
      .from('recommendations_new')
      .upsert(records, { onConflict: 'user_id,bank_account_id' });
  } catch (err) {
    console.warn('Error saving recommendations:', err);
  }
}

// ============================================================
// Helper Functions
// ============================================================

function mapDbUserToProfile(dbUser: Record<string, unknown>): UserProfile {
  // Map fee_sensitivity
  let feeSensitivity: 'low' | 'medium' | 'high' = 'medium';
  const dbFeeSensitivity = dbUser.fee_sensitivity as string;
  if (dbFeeSensitivity === 'very-sensitive' || dbFeeSensitivity === 'high') {
    feeSensitivity = 'high';
  } else if (dbFeeSensitivity === 'not-sensitive' || dbFeeSensitivity === 'low') {
    feeSensitivity = 'low';
  }

  // Map transfer frequency
  let transferFreq: 'never' | 'rarely' | 'monthly' | 'weekly' = 'monthly';
  const dbTransfers = dbUser.international_transfers as string;
  if (dbTransfers === 'never') transferFreq = 'never';
  else if (dbTransfers === 'rarely') transferFreq = 'rarely';
  else if (dbTransfers === 'weekly') transferFreq = 'weekly';

  return {
    id: dbUser.id as string,
    has_ssn: dbUser.has_ssn as boolean ?? false,
    has_itin: dbUser.has_itin as boolean ?? false,
    has_us_address: dbUser.has_us_address as boolean ?? false,
    university: dbUser.university as string | null,
    monthly_income: dbUser.monthly_income as number ?? 0,
    monthly_budget: dbUser.monthly_budget as number ?? 1500,
    expected_monthly_spending: dbUser.expected_monthly_spending as number ?? 1000,
    avg_monthly_balance: dbUser.monthly_budget as number ?? 1000,
    international_transfer_frequency: transferFreq,
    avg_transfer_amount: dbUser.avg_transfer_amount as number ?? 500,
    needs_zelle: dbUser.needs_zelle as boolean ?? false,
    wants_to_build_credit: (dbUser.credit_goals as string)?.includes('build') ?? true,
    fee_sensitivity: feeSensitivity,
    prefers_online_banking: dbUser.prefers_online_banking as boolean ??
      (dbUser.digital_preference === 'mobile-first'),
    needs_nearby_branch: dbUser.needs_nearby_branch as boolean ??
      (dbUser.campus_proximity === 'very-important'),
    preferred_language: dbUser.preferred_language as string ?? 'en',
  };
}

function mapDbBankToAccount(dbBank: Record<string, unknown>): BankAccount {
  // Parse pros/cons that might be JSON strings
  let pros: string[] = [];
  let cons: string[] = [];

  try {
    const prosData = dbBank.pros;
    if (typeof prosData === 'string') {
      pros = JSON.parse(prosData);
    } else if (Array.isArray(prosData)) {
      pros = prosData;
    }
  } catch { pros = []; }

  try {
    const consData = dbBank.cons;
    if (typeof consData === 'string') {
      cons = JSON.parse(consData);
    } else if (Array.isArray(consData)) {
      cons = consData;
    }
  } catch { cons = []; }

  return {
    id: dbBank.id as string,
    bank_name: dbBank.bank_name as string,
    account_type: dbBank.account_type as string,
    monthly_fee: dbBank.monthly_fee as number ?? 0,
    monthly_fee_waiver: dbBank.monthly_fee_waiver as string | null,
    min_balance: dbBank.min_balance as number ?? 0,
    min_opening_deposit: dbBank.min_opening_deposit as number ?? 0,
    foreign_transaction_fee: dbBank.foreign_transaction_fee as number ?? 0,
    intl_wire_outgoing: dbBank.intl_wire_outgoing as number ?? 0,
    intl_wire_incoming: dbBank.intl_wire_incoming as number ?? 0,
    ssn_required_online: dbBank.ssn_required_online as boolean ?? true,
    can_open_without_ssn: dbBank.can_open_without_ssn as boolean ?? false,
    itin_accepted: dbBank.itin_accepted as boolean ?? false,
    requires_in_person_for_no_ssn: dbBank.requires_in_person_for_no_ssn as boolean ?? false,
    has_zelle: dbBank.has_zelle as boolean ?? false,
    has_mobile_deposit: dbBank.has_mobile_deposit as boolean ?? false,
    savings_apy: dbBank.savings_apy as number ?? 0,
    is_nationwide: dbBank.is_nationwide as boolean ?? false,
    is_online_only: dbBank.is_online_only as boolean ?? false,
    has_student_account: dbBank.has_student_account as boolean ?? false,
    intl_student_friendly: dbBank.intl_student_friendly as boolean ?? false,
    intl_student_score: dbBank.intl_student_score as number ?? 50,
    opening_difficulty: dbBank.opening_difficulty as number ?? 3,
    digital_experience_score: dbBank.digital_experience_score as number ?? 50,
    customer_service_score: dbBank.customer_service_score as number ?? 50,
    branch_count: dbBank.branch_count as number ?? 0,
    atm_count: dbBank.atm_count as number ?? 0,
    pros,
    cons,
    apply_link: dbBank.apply_link as string | null,
  };
}
