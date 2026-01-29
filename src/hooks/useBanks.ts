import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface Bank {
  id: string;
  bank_name: string;
  account_type: string;
  country: string;
  monthly_fee: number;
  monthly_fee_waiver: string | null;
  min_balance: number;
  min_opening_deposit: number;
  foreign_transaction_fee: number;
  intl_wire_outgoing: number;
  intl_wire_incoming: number;
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
  pros: string[] | null;
  cons: string[] | null;
  apply_link: string | null;
  logo_url: string | null;
}

interface UseBanksOptions {
  country?: string;
  noSsnRequired?: boolean;
  limit?: number;
}

export function useBanks({
  country = 'US',
  noSsnRequired = false,
  limit = 20,
}: UseBanksOptions = {}) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBanks = useCallback(async () => {
    if (!supabase) {
      setError('Supabase not configured');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('banks')
        .select('*')
        .eq('country', country)
        .order('intl_student_friendly', { ascending: false })
        .limit(limit);

      if (noSsnRequired) {
        query = query.eq('can_open_without_ssn', true);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setBanks(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch banks');
      setBanks([]);
    } finally {
      setIsLoading(false);
    }
  }, [country, noSsnRequired, limit]);

  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  return {
    banks,
    isLoading,
    error,
    refetch: fetchBanks,
  };
}
