import { useState, useEffect, useCallback } from 'react';

export interface VisaType {
  id: string;
  country: string;
  visa_code: string;
  visa_name: string;
  description: string;
  duration: string;
  work_allowed: boolean;
  work_restrictions: string | null;
  requirements: string[] | null;
  documents_needed: string[] | null;
  renewal_info: string | null;
  application_link: string | null;
}

interface UseVisaTypesOptions {
  country?: string;
}

export function useVisaTypes({ country }: UseVisaTypesOptions = {}) {
  const [visaTypes, setVisaTypes] = useState<VisaType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVisaTypes = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get country from localStorage if not provided
      const savedCountry = typeof window !== 'undefined' ? localStorage.getItem('noor_selected_country') : null;
      const targetCountry = country || savedCountry || 'US';

      const params = new URLSearchParams({ country: targetCountry });
      const response = await fetch(`/api/visa-types?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch visa types');
      }

      setVisaTypes(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch visa types');
      setVisaTypes([]);
    } finally {
      setIsLoading(false);
    }
  }, [country]);

  useEffect(() => {
    fetchVisaTypes();
  }, [fetchVisaTypes]);

  return {
    visaTypes,
    isLoading,
    error,
    refetch: fetchVisaTypes,
  };
}
