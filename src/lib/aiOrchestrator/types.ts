export type Intent =
  | 'banking'
  | 'credit'
  | 'visa'
  | 'housing'
  | 'deals'
  | 'affordability'
  | 'general';

export type DbAccessLevel = 'none' | 'minimal';

export type AgentId =
  | 'general'
  | 'banking'
  | 'credit'
  | 'visa'
  | 'housing'
  | 'deals'
  | 'affordability';

export type AllowedSafeField =
  | 'destinationCountry'
  | 'visaType'
  | 'hasSSN'
  | 'hasITIN'
  | 'hasNIN'
  | 'hasSIN'
  | 'institutionType'
  | 'campusSide'
  | 'monthlyIncome'
  | 'university'
  | 'monthlyBudget'
  | 'expectedMonthlySpending'
  | 'checkingBalance'
  | 'upcomingObligationsSummary'
  | 'spendingCategoryTotals';

export interface AgentConfig {
  id: AgentId;
  dbAccess: DbAccessLevel;
  allowedFields: AllowedSafeField[];
  description: string;
}

export interface SafeUserContext {
  destinationCountry?: string;
  visaType?: string;
  hasSSN?: boolean;
  hasITIN?: boolean;
  hasNIN?: boolean;
  hasSIN?: boolean;
  institutionType?: string;
  campusSide?: string;
  monthlyIncome?: number;
  university?: string;
  monthlyBudget?: number;
  expectedMonthlySpending?: number;
  checkingBalance?: number;
  upcomingObligationsSummary?: string;
  spendingCategoryTotals?: string;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface OrchestratorResult {
  agentId: AgentId;
  intent: Intent;
  safeContext: SafeUserContext;
  productContext?: string;
}
