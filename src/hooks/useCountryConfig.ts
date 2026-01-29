import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Country,
  VisaType,
  RequiredDocument,
  HealthInsuranceOption,
  Bank,
  CountryDisplayConfig,
  getVisaTypes,
  getRequiredDocuments,
  getHealthInsurance,
  getBanks,
  getStudentFriendlyBanks,
  getBanksNoIdRequired,
  getCountryDisplay,
  getAllCountries,
} from '@/lib/countryConfig';

interface UseCountryConfigOptions {
  country: Country | null;
  studentOnly?: boolean;
  noIdRequired?: boolean;
}

interface CountryConfigData {
  info: CountryDisplayConfig | null;
  visaTypes: VisaType[];
  documents: RequiredDocument[];
  healthInsurance: HealthInsuranceOption[];
  banks: Bank[];
}

export function useCountryConfig({
  country,
  studentOnly = false,
  noIdRequired = false,
}: UseCountryConfigOptions) {
  const [isLoading, setIsLoading] = useState(false);

  const data = useMemo<CountryConfigData>(() => {
    if (!country) {
      return {
        info: null,
        visaTypes: [],
        documents: [],
        healthInsurance: [],
        banks: [],
      };
    }

    let banks: Bank[];
    if (noIdRequired) {
      banks = getBanksNoIdRequired(country);
    } else if (studentOnly) {
      banks = getStudentFriendlyBanks(country);
    } else {
      banks = getBanks(country);
    }

    return {
      info: getCountryDisplay(country),
      visaTypes: getVisaTypes(country),
      documents: getRequiredDocuments(country),
      healthInsurance: getHealthInsurance(country),
      banks,
    };
  }, [country, studentOnly, noIdRequired]);

  return {
    ...data,
    isLoading,
    country,
    availableCountries: getAllCountries(),
  };
}

// Hook for just visa types
export function useVisaTypes(country: Country | null) {
  return useMemo(() => {
    if (!country) return [];
    return getVisaTypes(country);
  }, [country]);
}

// Hook for just banks
export function useBanks(country: Country | null, options?: { studentOnly?: boolean; noIdRequired?: boolean }) {
  return useMemo(() => {
    if (!country) return [];
    if (options?.noIdRequired) {
      return getBanksNoIdRequired(country);
    }
    if (options?.studentOnly) {
      return getStudentFriendlyBanks(country);
    }
    return getBanks(country);
  }, [country, options?.studentOnly, options?.noIdRequired]);
}

// Hook for required documents
export function useRequiredDocuments(country: Country | null) {
  return useMemo(() => {
    if (!country) return [];
    return getRequiredDocuments(country);
  }, [country]);
}

// Hook for health insurance options
export function useHealthInsurance(country: Country | null) {
  return useMemo(() => {
    if (!country) return [];
    return getHealthInsurance(country);
  }, [country]);
}

// Hook for country display info
export function useCountryDisplay(country: Country | null) {
  return useMemo(() => {
    if (!country) return null;
    return getCountryDisplay(country);
  }, [country]);
}

// Hook for persisted country selection
const STORAGE_KEY = 'noor_selected_country';

export function useSelectedCountry() {
  const [country, setCountryState] = useState<Country | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['US', 'UK', 'CA'].includes(stored)) {
      setCountryState(stored as Country);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage when changed
  const setCountry = useCallback((newCountry: Country | null) => {
    setCountryState(newCountry);
    if (newCountry) {
      localStorage.setItem(STORAGE_KEY, newCountry);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return {
    country,
    setCountry,
    isLoaded,
    availableCountries: getAllCountries(),
  };
}

// Hook to get country-specific labels
export function useCountryLabels(country: Country | null) {
  return useMemo(() => {
    if (!country) {
      return {
        taxIdLabel: 'Tax ID',
        taxIdShortLabel: 'ID',
        taxIdDescription: 'Tax identification number',
        healthInsuranceLabel: 'Health Insurance',
        visaLabel: 'Visa',
        currencySymbol: '$',
        currencyCode: 'USD',
      };
    }

    const labels = {
      US: {
        taxIdLabel: 'Social Security Number',
        taxIdShortLabel: 'SSN',
        taxIdDescription: 'Required for employment and building credit in the US',
        healthInsuranceLabel: 'Student Health Insurance Plan (SHIP)',
        visaLabel: 'F-1 Student Visa',
        currencySymbol: '$',
        currencyCode: 'USD',
      },
      UK: {
        taxIdLabel: 'National Insurance Number',
        taxIdShortLabel: 'NIN',
        taxIdDescription: 'Required for employment in the UK',
        healthInsuranceLabel: 'NHS Registration',
        visaLabel: 'Student Visa (Tier 4)',
        currencySymbol: '£',
        currencyCode: 'GBP',
      },
      CA: {
        taxIdLabel: 'Social Insurance Number',
        taxIdShortLabel: 'SIN',
        taxIdDescription: 'Required for working in Canada',
        healthInsuranceLabel: 'Provincial Health Insurance',
        visaLabel: 'Study Permit',
        currencySymbol: '$',
        currencyCode: 'CAD',
      },
    };

    return labels[country];
  }, [country]);
}

export default useCountryConfig;
