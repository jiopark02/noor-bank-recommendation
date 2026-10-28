/**
 * Country-Specific Configuration
 * Defines the currency shown for each country
 */

export type Country = 'US' | 'UK' | 'CA';

// =============================================================================
// COUNTRY DISPLAY CONFIGURATION
// =============================================================================

export interface CountryDisplayConfig {
  currency: string;
  currencySymbol: string;
}

export const COUNTRY_DISPLAY: Record<Country, CountryDisplayConfig> = {
  US: {
    currency: 'USD',
    currencySymbol: '$',
  },
  UK: {
    currency: 'GBP',
    currencySymbol: '£',
  },
  CA: {
    currency: 'CAD',
    currencySymbol: '$',
  },
};
