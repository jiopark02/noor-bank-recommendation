import type { Intent } from './types';

const KEYWORDS: Record<Intent, string[]> = {
  banking: [
    'bank',
    'banks',
    'banking',
    'account',
    'checking',
    'savings',
    'ssn',
    'itin',
    '계좌',
    '은행',
    'zelle',
    'wire',
    '송금',
  ],
  credit: [
    'credit',
    'credit card',
    'card',
    'fico',
    'score',
    'secured',
    '크레딧',
    '신용',
    '카드',
  ],
  visa: ['visa', 'f-1', 'j-1', 'opt', 'cpt', 'sevis', 'i-20', '비자'],
  housing: ['housing', 'house', 'apartment', 'rent', 'lease', 'roommate', '집', '아파트', '렌트'],
  deals: ['deal', 'discount', 'offer', 'promo', 'coupon', '장학금', '할인'],
  affordability: [
    'afford',
    'can i afford',
    'on track',
    'budget strain',
    'projected balance',
    'spending cap',
    'broke',
    'saving',
    'savings',
    'overdraft',
    'balance',
    'dinner',
    'gym membership',
    'flight',
    'tax refund',
  ],
  general: [],
};

export function classifyIntent(lastUserMessage: string): Intent {
  const text = (lastUserMessage || '').toLowerCase().trim();
  if (!text) return 'general';

  const ordered: Intent[] = ['affordability', 'banking', 'credit', 'visa', 'housing', 'deals'];
  for (const intent of ordered) {
    if (KEYWORDS[intent].some((keyword) => text.includes(keyword))) {
      return intent;
    }
  }

  return 'general';
}
