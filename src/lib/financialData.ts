// Financial Dashboard Data - Budget, Transactions, Categories

export type TransactionCategory = 'rent' | 'food' | 'transport' | 'entertainment' | 'tuition' | 'utilities' | 'shopping' | 'other';

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  category: TransactionCategory;
  description: string;
  date: string;
  type: 'expense' | 'income';
}

export interface Budget {
  category: TransactionCategory;
  limit: number;
  spent: number;
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  total_budget: number;
  budgets: Budget[];
}

export interface FinancialSummary {
  total_budget: number;
  total_spent: number;
  remaining: number;
  percentage_used: number;
  by_category: Budget[];
}

// Category info
export const CATEGORIES: Record<TransactionCategory, { label: string; icon: string; color: string }> = {
  rent: { label: 'Rent', icon: '🏠', color: '#ef4444' },
  food: { label: 'Food', icon: '🍔', color: '#f97316' },
  transport: { label: 'Transport', icon: '🚗', color: '#eab308' },
  entertainment: { label: 'Entertainment', icon: '🎬', color: '#22c55e' },
  tuition: { label: 'Tuition', icon: '🎓', color: '#3b82f6' },
  utilities: { label: 'Utilities', icon: '💡', color: '#8b5cf6' },
  shopping: { label: 'Shopping', icon: '🛒', color: '#ec4899' },
  other: { label: 'Other', icon: '📦', color: '#6b7280' },
};

// Storage keys
const STORAGE_KEY_TRANSACTIONS = 'noor_transactions';
const STORAGE_KEY_BUDGET = 'noor_budget';

// Default budget
const DEFAULT_BUDGET: MonthlyBudget = {
  month: getCurrentMonth(),
  total_budget: 2500,
  budgets: [
    { category: 'rent', limit: 1200, spent: 1200 },
    { category: 'food', limit: 400, spent: 285 },
    { category: 'transport', limit: 150, spent: 89 },
    { category: 'entertainment', limit: 100, spent: 45 },
    { category: 'tuition', limit: 0, spent: 0 },
    { category: 'utilities', limit: 100, spent: 78 },
    { category: 'shopping', limit: 200, spent: 156 },
    { category: 'other', limit: 350, spent: 120 },
  ],
};

// Default transactions for demo
const DEFAULT_TRANSACTIONS: Transaction[] = [
  {
    id: 't1',
    user_id: 'current_user',
    amount: 1200,
    category: 'rent',
    description: 'Monthly rent - January',
    date: '2026-01-01',
    type: 'expense',
  },
  {
    id: 't2',
    user_id: 'current_user',
    amount: 45.50,
    category: 'food',
    description: 'Grocery shopping - Trader Joe\'s',
    date: '2026-01-20',
    type: 'expense',
  },
  {
    id: 't3',
    user_id: 'current_user',
    amount: 12.99,
    category: 'entertainment',
    description: 'Netflix subscription',
    date: '2026-01-15',
    type: 'expense',
  },
  {
    id: 't4',
    user_id: 'current_user',
    amount: 35,
    category: 'transport',
    description: 'Gas',
    date: '2026-01-18',
    type: 'expense',
  },
  {
    id: 't5',
    user_id: 'current_user',
    amount: 89.99,
    category: 'shopping',
    description: 'Amazon - textbooks',
    date: '2026-01-12',
    type: 'expense',
  },
  {
    id: 't6',
    user_id: 'current_user',
    amount: 28.50,
    category: 'food',
    description: 'Dinner with friends',
    date: '2026-01-19',
    type: 'expense',
  },
  {
    id: 't7',
    user_id: 'current_user',
    amount: 78,
    category: 'utilities',
    description: 'Electric bill',
    date: '2026-01-10',
    type: 'expense',
  },
  {
    id: 't8',
    user_id: 'current_user',
    amount: 54,
    category: 'transport',
    description: 'Uber rides',
    date: '2026-01-22',
    type: 'expense',
  },
  {
    id: 't9',
    user_id: 'current_user',
    amount: 156.78,
    category: 'food',
    description: 'Costco run',
    date: '2026-01-08',
    type: 'expense',
  },
  {
    id: 't10',
    user_id: 'current_user',
    amount: 32.15,
    category: 'entertainment',
    description: 'Movie tickets',
    date: '2026-01-21',
    type: 'expense',
  },
];

// Helper functions
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Get transactions
export function getTransactions(month?: string): Transaction[] {
  if (typeof window === 'undefined') return DEFAULT_TRANSACTIONS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TRANSACTIONS);
    let transactions: Transaction[] = stored ? JSON.parse(stored) : DEFAULT_TRANSACTIONS;

    if (month) {
      transactions = transactions.filter(t => t.date.startsWith(month));
    }

    return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch {
    return DEFAULT_TRANSACTIONS;
  }
}

// Add transaction
export function addTransaction(transaction: Omit<Transaction, 'id' | 'user_id'>): Transaction {
  const newTransaction: Transaction = {
    ...transaction,
    id: `t_${Date.now()}`,
    user_id: 'current_user',
  };

  if (typeof window !== 'undefined') {
    const transactions = getTransactions();
    transactions.unshift(newTransaction);
    localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(transactions));

    // Update budget spent
    if (newTransaction.type === 'expense') {
      updateBudgetSpent(newTransaction.category, newTransaction.amount);
    }
  }

  return newTransaction;
}

// Delete transaction
export function deleteTransaction(id: string): void {
  if (typeof window === 'undefined') return;
  const transactions = getTransactions();
  const updated = transactions.filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(updated));
}

// Get budget
export function getBudget(month?: string): MonthlyBudget {
  const targetMonth = month || getCurrentMonth();
  if (typeof window === 'undefined') return DEFAULT_BUDGET;

  try {
    const stored = localStorage.getItem(STORAGE_KEY_BUDGET);
    if (stored) {
      const budgets: Record<string, MonthlyBudget> = JSON.parse(stored);
      if (budgets[targetMonth]) {
        return budgets[targetMonth];
      }
    }
    return { ...DEFAULT_BUDGET, month: targetMonth };
  } catch {
    return DEFAULT_BUDGET;
  }
}

// Save budget
export function saveBudget(budget: MonthlyBudget): void {
  if (typeof window === 'undefined') return;

  try {
    const stored = localStorage.getItem(STORAGE_KEY_BUDGET);
    const budgets: Record<string, MonthlyBudget> = stored ? JSON.parse(stored) : {};
    budgets[budget.month] = budget;
    localStorage.setItem(STORAGE_KEY_BUDGET, JSON.stringify(budgets));
  } catch {
    // Ignore
  }
}

// Update budget limit for a category
export function updateBudgetLimit(category: TransactionCategory, limit: number): MonthlyBudget {
  const budget = getBudget();
  const categoryBudget = budget.budgets.find(b => b.category === category);
  if (categoryBudget) {
    categoryBudget.limit = limit;
  }
  budget.total_budget = budget.budgets.reduce((sum, b) => sum + b.limit, 0);
  saveBudget(budget);
  return budget;
}

// Update spent amount
function updateBudgetSpent(category: TransactionCategory, amount: number): void {
  const budget = getBudget();
  const categoryBudget = budget.budgets.find(b => b.category === category);
  if (categoryBudget) {
    categoryBudget.spent += amount;
  }
  saveBudget(budget);
}

// Get financial summary
export function getFinancialSummary(month?: string): FinancialSummary {
  const budget = getBudget(month);
  const totalSpent = budget.budgets.reduce((sum, b) => sum + b.spent, 0);

  return {
    total_budget: budget.total_budget,
    total_spent: totalSpent,
    remaining: budget.total_budget - totalSpent,
    percentage_used: budget.total_budget > 0 ? (totalSpent / budget.total_budget) * 100 : 0,
    by_category: budget.budgets,
  };
}

// Format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Get spending by category for the month
export function getSpendingByCategory(month?: string): { category: TransactionCategory; amount: number; percentage: number }[] {
  const transactions = getTransactions(month).filter(t => t.type === 'expense');
  const totalSpent = transactions.reduce((sum, t) => sum + t.amount, 0);

  const byCategory: Record<TransactionCategory, number> = {
    rent: 0,
    food: 0,
    transport: 0,
    entertainment: 0,
    tuition: 0,
    utilities: 0,
    shopping: 0,
    other: 0,
  };

  transactions.forEach(t => {
    byCategory[t.category] += t.amount;
  });

  return Object.entries(byCategory)
    .map(([category, amount]) => ({
      category: category as TransactionCategory,
      amount,
      percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}
