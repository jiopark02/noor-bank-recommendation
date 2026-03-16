import type { AgentConfig, AgentId, Intent } from './types';

export const AGENTS: Record<AgentId, AgentConfig> = {
  general: {
    id: 'general',
    dbAccess: 'none',
    allowedFields: [],
    description: 'General FAQ and conversations without DB access.',
  },
  banking: {
    id: 'banking',
    dbAccess: 'minimal',
    allowedFields: [
      'destinationCountry',
      'hasSSN',
      'hasITIN',
      'institutionType',
      'campusSide',
      'incomeBand',
      'university',
    ],
    description: 'Banking recommendations with minimal safe context.',
  },
  credit: {
    id: 'credit',
    dbAccess: 'minimal',
    allowedFields: ['destinationCountry', 'hasSSN', 'hasITIN', 'institutionType', 'incomeBand'],
    description: 'Credit guidance with minimal safe context.',
  },
  visa: {
    id: 'visa',
    dbAccess: 'minimal',
    allowedFields: ['destinationCountry', 'visaType', 'institutionType'],
    description: 'Visa guidance with minimal safe context.',
  },
  housing: {
    id: 'housing',
    dbAccess: 'minimal',
    allowedFields: ['destinationCountry', 'campusSide', 'university', 'incomeBand'],
    description: 'Housing guidance with minimal safe context.',
  },
  deals: {
    id: 'deals',
    dbAccess: 'none',
    allowedFields: [],
    description: 'Deals and offers without user DB access.',
  },
  affordability: {
    id: 'affordability',
    dbAccess: 'minimal',
    allowedFields: [
      'checkingBalance',
      'upcomingObligationsSummary',
      'incomeBand',
      'spendingCategoryTotals',
    ],
    description: 'Affordability analysis using minimal aggregated data.',
  },
};

export const INTENT_TO_AGENT: Record<Intent, AgentId> = {
  banking: 'banking',
  credit: 'credit',
  visa: 'visa',
  housing: 'housing',
  deals: 'deals',
  affordability: 'affordability',
  general: 'general',
};

export function getAgentForIntent(intent: Intent): AgentConfig {
  return AGENTS[INTENT_TO_AGENT[intent]];
}
