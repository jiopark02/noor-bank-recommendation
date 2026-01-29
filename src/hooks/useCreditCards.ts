import { useState, useEffect, useCallback } from 'react';

export interface CreditCard {
  id: string;
  card_name: string;
  issuer: string;
  card_type: string;
  annual_fee: number;
  apr_min: number | null;
  apr_max: number | null;
  rewards_rate: string | null;
  signup_bonus: string | null;
  foreign_transaction_fee: number;
  credit_needed: string | null;
  ssn_required: boolean;
  itin_accepted: boolean;
  requires_credit_history: boolean;
  f1_friendly: boolean;
  f1_notes: string | null;
  benefits: string[] | null;
  drawbacks: string[] | null;
  best_for: string | null;
  apply_link: string | null;
  logo_url: string | null;
}

interface UseCreditCardsOptions {
  limit?: number;
  f1Only?: boolean;
  noSsn?: boolean;
  autoFetch?: boolean;
  country?: string;
}

interface UseCreditCardsReturn {
  cards: CreditCard[];
  isLoading: boolean;
  error: string | null;
  total: number;
  refetch: () => Promise<void>;
}

export function useCreditCards({
  limit = 20,
  f1Only = true,
  noSsn = false,
  autoFetch = true,
  country = 'US',
}: UseCreditCardsOptions = {}): UseCreditCardsReturn {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchCards = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (f1Only) params.set('f1', 'true');
      if (noSsn) params.set('no_ssn', 'true');
      if (country) params.set('country', country);

      const response = await fetch(`/api/credit-cards?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch credit cards');
      }

      const data = await response.json();
      setCards(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setCards([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit, f1Only, noSsn, country]);

  useEffect(() => {
    if (autoFetch) {
      fetchCards();
    }
  }, [autoFetch, fetchCards]);

  return {
    cards,
    isLoading,
    error,
    total,
    refetch: fetchCards,
  };
}
