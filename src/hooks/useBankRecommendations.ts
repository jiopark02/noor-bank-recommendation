import { useState, useEffect, useCallback } from 'react';

// Types from bankRecommendation.ts v2
export interface MatchReason {
  type: 'positive' | 'warning' | 'info';
  icon: string;
  title: string;
  description: string;
  priority: number;
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
  no_ssn_note?: string | null;
}

export interface ComparisonHighlight {
  value: string;
  isGood: boolean;
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
    fees: ComparisonHighlight;
    accessibility: ComparisonHighlight;
    features: ComparisonHighlight;
    internationalTransfers: ComparisonHighlight;
  };
  categoryPick?: CategoryPick;
}

interface UseBankRecommendationsOptions {
  userId: string | null;
  limit?: number;
  autoFetch?: boolean;
}

interface UseBankRecommendationsReturn {
  recommendations: BankRecommendation[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  saveBank: (bankId: string) => Promise<void>;
  dismissBank: (bankId: string) => Promise<void>;
}

export function useBankRecommendations({
  userId,
  limit = 5,
  autoFetch = true,
}: UseBankRecommendationsOptions): UseBankRecommendationsReturn {
  const [recommendations, setRecommendations] = useState<BankRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    if (!userId) {
      setRecommendations([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/recommendations/bank?userId=${userId}&limit=${limit}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch recommendations');
      }

      const data = await response.json();
      setRecommendations(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setRecommendations([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId, limit]);

  useEffect(() => {
    if (autoFetch) {
      fetchRecommendations();
    }
  }, [autoFetch, fetchRecommendations]);

  const saveBank = useCallback(async (bankId: string) => {
    if (!userId) return;

    try {
      await fetch('/api/recommendations/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          recommendationId: bankId,
          action: 'save',
        }),
      });
    } catch (err) {
      console.error('Failed to save bank:', err);
    }
  }, [userId]);

  const dismissBank = useCallback(async (bankId: string) => {
    if (!userId) return;

    try {
      await fetch('/api/recommendations/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          recommendationId: bankId,
          action: 'dismiss',
        }),
      });

      // Remove from local state
      setRecommendations(prev =>
        prev.filter(rec => rec.bank.id !== bankId)
      );
    } catch (err) {
      console.error('Failed to dismiss bank:', err);
    }
  }, [userId]);

  return {
    recommendations,
    isLoading,
    error,
    refetch: fetchRecommendations,
    saveBank,
    dismissBank,
  };
}
