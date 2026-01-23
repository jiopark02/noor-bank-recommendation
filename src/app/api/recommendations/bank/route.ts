import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getRecommendations, saveRecommendations, BankRecommendation } from '@/lib/bankRecommendation';

// Mock data for development
const MOCK_BANKS: BankRecommendation[] = [
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '5');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    try {
      // Try to get real recommendations
      const recommendations = await getRecommendations(supabase, userId, limit);

      // Save to DB (async, ignore errors)
      saveRecommendations(supabase, userId, recommendations).catch(console.error);

      return NextResponse.json({
        success: true,
        data: recommendations,
        meta: {
          total: recommendations.length,
          algorithm_version: 'v2',
        },
      });
    } catch (dbError) {
      // Fallback to mock data for development
      console.warn('Using mock data:', dbError);

      return NextResponse.json({
        success: true,
        data: MOCK_BANKS.slice(0, limit),
        meta: {
          total: MOCK_BANKS.length,
          algorithm_version: 'mock',
        },
      });
    }
  } catch (error) {
    console.error('Bank recommendation error:', error);

    // Return mock data even on error
    return NextResponse.json({
      success: true,
      data: MOCK_BANKS.slice(0, 5),
      meta: {
        total: MOCK_BANKS.length,
        algorithm_version: 'mock',
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
